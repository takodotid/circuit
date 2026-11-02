// A project pins its Circuit in .circuit-version; the version kept for it lives in ~/.circuit/versions.

import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
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
    await Versions.runPinned(root, ["validate"]);
});
