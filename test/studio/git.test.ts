// Studio reads git for a device's history and for comparisons: commits that changed a file, branches and commits to compare with, and the network as it was at a commit, read from a checkout that is removed afterwards.

import { afterAll, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compareNetworks } from "../../src/studio/public/evaluate.js";
import { commitOf, history, networkAt, references } from "../../src/studio/git";

const root = mkdtempSync(join(tmpdir(), "circuit-studio-git-"));

// A test run from a git hook inherits GIT_DIR and the like, which would point these commands at Circuit's own repository.
const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")));
const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.name=Studio", "-c", "user.email=studio@example.com", ...args], { cwd: root, encoding: "utf8", env });

git("init", "-q", "-b", "main");
// On a machine with core.autocrlf, a checkout would turn the files' line endings into CRLF.
git("config", "core.autocrlf", "false");
mkdirSync(join(root, "network"));
writeFileSync(join(root, "network", "circuit.config.ts"), "first\n");
writeFileSync(join(root, "network", "edge-01.ts"), "edge\n");
git("add", "-A");
git("commit", "-q", "-m", "First");
writeFileSync(join(root, "network", "circuit.config.ts"), "second\n");
git("commit", "-q", "-am", "Second");

afterAll(() => rmSync(root, { recursive: true, force: true }));

const directory = join(root, "network");

test("history lists the commits that changed a file, newest first", async () => {
    expect((await history(directory, ["circuit.config.ts"])).map((commit) => commit.subject)).toEqual(["Second", "First"]);
    expect((await history(directory, ["edge-01.ts"])).map((commit) => commit.subject)).toEqual(["First"]);
    expect(await history(directory, [])).toEqual([]);
});

test("references lists branches and the latest commits, and commitOf takes only a git name", async () => {
    const found = await references(directory);
    expect(found.names).toEqual(["main"]);
    expect(found.commits.map((commit) => commit.subject)).toEqual(["Second", "First"]);

    expect((await commitOf(directory, "HEAD~1"))?.subject).toBe("First");
    expect(await commitOf(directory, "--output=x")).toBeUndefined();
    expect(await commitOf(directory, "no-such-branch")).toBeUndefined();
});

test("networkAt reads the config as it was at a commit, from a checkout git ignores and removes", async () => {
    const first = (await commitOf(directory, "HEAD~1"))!;
    let seen = "";

    const read = await networkAt(directory, join(directory, "circuit.config.ts"), first.commit, async (configPath) => {
        seen = configPath;
        return readFileSync(configPath, "utf8");
    });

    expect(read).toBe("first\n");
    expect(seen.replaceAll("\\", "/")).toContain("/.circuit/cache/");
    expect(existsSync(seen)).toBe(false);
    expect(git("status", "--porcelain")).toBe("");
});

test("compareNetworks finds devices changed, added and removed, the graph's new and gone lines, and new and resolved findings", () => {
    const network = (devices: string[], rendered: Record<string, string>, edges: string[], findings: string[]) =>
        ({
            devices: devices.map((name) => ({ name })),
            rendered,
            graph: {
                nodes: [],
                edges: edges.map((label) => ({ layer: "l1", from: "device:a", to: "device:b", label, detail: [] })),
                findings: findings.map((message) => ({ level: "error", device: "a", message })),
                drift: {},
            },
        }) as never;

    const before = network(["a", "b", "gone"], { a: "x", b: "y", gone: "z" }, ["one", "two"], ["old problem"]);
    const after = network(["a", "b", "new"], { a: "x", b: "y2", new: "w" }, ["two", "three"], ["new problem"]);
    const found = compareNetworks(before, after);

    expect(found.devices).toEqual({ added: ["new"], removed: ["gone"], changed: ["b"] });
    expect(found.edges.added.map((edge) => edge.label)).toEqual(["three"]);
    expect(found.edges.removed.map((edge) => edge.label)).toEqual(["one"]);
    expect(found.findings.added.map((one) => one.message)).toEqual(["new problem"]);
    expect(found.findings.resolved.map((one) => one.message)).toEqual(["old problem"]);
});
