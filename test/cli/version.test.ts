// The binary says the version package.json says.

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { VERSION } from "../../src/cli/version";

const root = join(import.meta.dir, "..", "..");

test("the version is package.json's", () => {
    expect(VERSION).toBe(JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version);
});
