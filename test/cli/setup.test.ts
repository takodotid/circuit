// A new project, as the installer sets it up: its files, the git hook, the secrets file kept in git, and a project Circuit reads.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Setup } from "../../src/cli/setup";
import { EditorTypes } from "../../src/cli/editor-types";
import { VERSION } from "../../src/cli/version";
import { Versions } from "../../src/cli/versions";
import { SecretsFile } from "../../src/core/secrets-file";
import { readProject } from "../../src/project/project";

// Inside a git hook, such as this repository's own, git's variables point every git command at this repository instead of the test's.
for (const name of Object.keys(process.env)) if (name.startsWith("GIT_")) delete process.env[name];

const parent = mkdtempSync(join(tmpdir(), "circuit-setup-"));
let root: string;

beforeAll(async () => {
    const cwd = process.cwd();
    process.chdir(parent);
    try {
        root = await Setup.create({
            folder: "network",
            kind: "simple",
            asn: 64500,
            git: true,
            openInEditor: false,
        });
    } finally {
        process.chdir(cwd);
    }
});

afterAll(() => rmSync(parent, { recursive: true, force: true }));

test("the project's files are written", () => {
    for (const file of [
        "circuit.ts",
        "tsconfig.json",
        ".gitignore",
        "tenants/README.md",
        ".circuit/hooks/pre-commit",
        ".circuit/version",
        ".circuit/DO_NOT_EDIT.md",
        ".editorconfig",
        ".vscode/settings.json",
        ".vscode/extensions.json",
    ]) {
        expect(existsSync(join(root, file))).toBe(true);
    }

    expect(readFileSync(join(root, "circuit.ts"), "utf8")).toContain("export const as64500 = circuit({");
    expect(EditorTypes.current(root)).toBe(true);
    expect(Versions.pinned(root)).toBe(VERSION);
});

test("the secrets file is kept in git", () => {
    const ignored = (file: string) => spawnSync("git", ["-C", root, "check-ignore", "-q", file], { env: process.env }).status === 0;
    expect(ignored(SecretsFile.DEFAULT)).toBe(false);
    expect(ignored(".circuit/cache/x")).toBe(true);
});

test("git checks each commit with the project's hook", () => {
    const hooks = spawnSync("git", ["-C", root, "config", "--get", "core.hooksPath"], { encoding: "utf8", env: process.env });
    expect(hooks.stdout.trim()).toBe(".circuit/hooks");
});

test("Circuit reads the new project", async () => {
    const read = await readProject(root);
    expect(read.networks.map((network) => network.name)).toEqual(["as64500"]);
});

// Every project has a circuit.ts, and `bun circuit` with no script of that name runs it instead of the package's `circuit`. The
// script runs whichever `circuit` it finds, the package's in a full install: here the app, or none, so it only must not be circuit.ts.
test("in a full install, bun circuit runs the script, never the project's circuit.ts", () => {
    const folder = join(parent, "full");
    mkdirSync(folder);
    writeFileSync(join(folder, "package.json"), Setup.packageJson("full"));
    writeFileSync(join(folder, "circuit.ts"), 'console.log("the circuit.ts ran");\n');

    // Should the app be on PATH, it updates nothing and keeps to this test's folder.
    const env = { ...process.env, CIRCUIT_HOME: join(parent, "home"), CIRCUIT_UPDATED: "1" };
    const run = spawnSync("bun", ["circuit", "--version"], { cwd: folder, encoding: "utf8", env });
    expect(run.stderr).toContain("$ circuit --version");
    expect(run.stdout + run.stderr).not.toContain("circuit.ts ran");
});
