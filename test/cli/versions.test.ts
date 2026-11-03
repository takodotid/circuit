// A project pins its Circuit in .circuit/version; the version kept for it lives in ~/.circuit/versions.

import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Versions } from "../../src/cli/versions";

let root = "";
afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = "";
});

test("a project pins a version, and reads it back", () => {
    root = mkdtempSync(join(tmpdir(), "circuit-versions-"));

    expect(Versions.pinned(root)).toBeUndefined();
    Versions.pin(root, "1.0.0-rc.1");
    expect(Versions.pinned(root)).toBe("1.0.0-rc.1");
});

test("each version is kept in its own folder", () => {
    expect(Versions.path("1.0.0").replaceAll("\\", "/")).toMatch(/\.circuit\/versions\/1\.0\.0\/circuit(\.exe)?$/);
});

test("run from the sources, Circuit never starts another version", async () => {
    root = mkdtempSync(join(tmpdir(), "circuit-versions-"));
    Versions.pin(root, "0.0.1");

    // Returns, rather than ending the process: this is not the installed app.
    await Versions.run(root, ["validate"]);
});

test("a kept version no project pins any more is removed; the app's own is never kept apart", () => {
    root = mkdtempSync(join(tmpdir(), "circuit-versions-"));
    process.env.CIRCUIT_HOME = join(root, "home");
    try {
        const project = (name: string, version: string) => {
            const folder = join(root, name);
            mkdirSync(folder, { recursive: true });
            writeFileSync(join(folder, "circuit.ts"), "");
            Versions.pin(folder, version);
            Versions.remember(folder);
            return folder;
        };
        const keep = (version: string) => {
            mkdirSync(join(Versions.path(version), ".."), { recursive: true });
            writeFileSync(Versions.path(version), "");
        };

        const a = project("a", "1.1.0");
        project("b", "1.2.0");
        const gone = project("c", "1.0.0");
        for (const version of ["1.0.0", "1.1.0", "1.2.0", "1.3.0"]) keep(version);
        rmSync(gone, { recursive: true });
        Versions.remember(a);

        expect(Versions.prune("1.2.0").sort()).toEqual(["1.0.0", "1.2.0", "1.3.0"]);
        expect(existsSync(Versions.path("1.1.0"))).toBe(true);
        expect(Versions.known()).toEqual([a, join(root, "b")]);

        // A project moved on: the version it left goes too.
        Versions.pin(a, "1.2.0");
        expect(Versions.prune("1.2.0")).toEqual(["1.1.0"]);
    } finally {
        delete process.env.CIRCUIT_HOME;
    }
});
