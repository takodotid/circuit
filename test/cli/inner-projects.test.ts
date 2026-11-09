// A project inside another project's folder, such as a customer's in `customers/<name>/`: the commit hook checks it with its own
// Circuit, and `circuit fmt` gives its files the outer project's style.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Format } from "../../src/cli/format";
import { GitHooks } from "../../src/cli/git-hooks";
import { Setup } from "../../src/cli/setup";

// Inside a git hook, such as this repository's own, git's variables point every git command at this repository instead of the test's.
for (const name of Object.keys(process.env)) if (name.startsWith("GIT_")) delete process.env[name];

const parent = mkdtempSync(join(tmpdir(), "circuit-inner-"));
const cli = join(import.meta.dir, "..", "..", "src", "cli", "index.ts");
let root = "";
let inner = "";

const git = (...args: string[]) => spawnSync("git", ["-C", root, ...args], { encoding: "utf8", env: process.env });
const hook = () =>
    spawnSync("bun", [cli, "hook", "pre-commit"], {
        cwd: root,
        encoding: "utf8",
        env: { ...process.env, CIRCUIT_HOME: join(parent, "home"), CIRCUIT_LOCAL: "1", CIRCUIT_SECRETS_PASSWORD: "test password" },
    });

beforeAll(async () => {
    const cwd = process.cwd();
    process.chdir(parent);
    try {
        root = await Setup.create({ folder: "network", kind: "simple", asn: 64500, git: true, openInEditor: false });
    } finally {
        process.chdir(cwd);
    }

    inner = join(root, "customers", "acme");
    mkdirSync(join(inner, ".circuit"), { recursive: true });
    writeFileSync(join(inner, "circuit.ts"), "export const acme = circuit({});\n");
});

afterAll(() => rmSync(parent, { recursive: true, force: true }));

test("the projects inside a project are found, and none inside those", () => {
    mkdirSync(join(inner, "nested"), { recursive: true });
    writeFileSync(join(inner, "nested", "circuit.ts"), "");

    expect(GitHooks.innerProjects(root)).toEqual([inner]);
    expect(GitHooks.innerProjects(inner)).toEqual([join(inner, "nested")]);

    rmSync(join(inner, "nested"), { recursive: true });
});

test("the commit hook stops a secret in plain text in a project inside", () => {
    writeFileSync(join(inner, ".circuit", "secrets"), 'TOKEN="in plain text"\n');
    git("add", "-A");

    const stopped = hook();
    expect(stopped.status).toBe(1);
    expect(stopped.stdout).toContain("The project in customers/acme");
    expect(stopped.stderr).toContain("customers/acme/.circuit/secrets");
    expect(stopped.stderr).toContain("The commit was stopped by the project in customers/acme.");

    rmSync(join(inner, ".circuit", "secrets"));
    git("add", "-A");
    const passed = hook();
    expect(passed.stderr).toBe("");
    expect(passed.status).toBe(0);
});

test("a file of a project inside takes the outer project's style", async () => {
    const file = join(inner, "circuit.ts");
    writeFileSync(file, "export const acme = circuit({sites:{home:{description:'Acme'}}})\n");

    expect(Format.style(inner)).toEqual(Format.style(root));
    await Format.run(inner, [], false);
    expect(readFileSync(file, "utf8")).toBe('export const acme = circuit({ sites: { home: { description: "Acme" } } });\n');
});

test("a file named outside the project is formatted in its own folder's style", async () => {
    const shared = join(root, "customers", "shared.ts");
    writeFileSync(shared, "export const shared = {\nname:'acme'}\n");

    const cwd = process.cwd();
    process.chdir(inner);
    try {
        await Format.run(inner, ["../shared.ts"], false);
    } finally {
        process.chdir(cwd);
    }
    expect(readFileSync(shared, "utf8")).toBe('export const shared = {\n    name: "acme",\n};\n');
});
