// What `circuit init` writes for the editor is the sources as they are, and the binary says the version package.json says.

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { generated } from "../../scripts/editor-types";
import { VERSION } from "../../src/cli/version";

const root = join(import.meta.dir, "..", "..");

test("editor-types.generated.ts is current: bun run build writes it", () => {
    expect(readFileSync(join(root, "src", "cli", "editor-types.generated.ts"), "utf8")).toBe(generated());
});

test("the version is package.json's", () => {
    expect(VERSION).toBe(JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version);
});
