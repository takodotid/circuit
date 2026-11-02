// A new project, as the installer sets it up: its files, an encrypted .env with the key kept out of git, the git hook, and a project Circuit reads.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Setup } from "../../src/cli/setup";
import { EditorTypes } from "../../src/cli/editor-types";
import { VERSION } from "../../src/cli/version";
import { Versions } from "../../src/cli/versions";
import { EnvFile } from "../../src/core/env-file";
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
            keys: { kind: "file" },
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
        ".env",
        ".env.keys",
        "tenants/README.md",
        ".circuit/hooks/pre-commit",
        ".circuit-version",
        ".prettierrc.json",
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

test(".env is encrypted and committed; its key is kept out of git", () => {
    const env = new EnvFile(root);
    expect(env.publicKey()).toBeDefined();
    expect(env.plaintext()).toEqual([]);

    const ignored = (file: string) => spawnSync("git", ["-C", root, "check-ignore", "-q", file], { env: process.env }).status === 0;
    expect(ignored(".env.keys")).toBe(true);
    expect(ignored(".env")).toBe(false);
});

test("git checks each commit with the project's hook", () => {
    const hooks = spawnSync("git", ["-C", root, "config", "--get", "core.hooksPath"], { encoding: "utf8", env: process.env });
    expect(hooks.stdout.trim()).toBe(".circuit/hooks");
});

test("Circuit reads the new project", async () => {
    const read = await readProject(root);
    expect(read.networks.map((network) => network.name)).toEqual(["as64500"]);
});
