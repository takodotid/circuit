// The example projects in examples/, which the docs and the Academy show: each passes the editor's types, as TypeScript 7 and 6 read them, and `circuit validate`.

import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Validation } from "../../src/checks";
import { EditorTypes } from "../../src/cli/editor-types";
import { readProject } from "../../src/project/project";

const root = join(import.meta.dir, "..", "..");
const examples = join(root, "examples");
const scratch = mkdtempSync(join(tmpdir(), "circuit-example-projects-"));

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

for (const name of readdirSync(examples)) {
    describe(name, () => {
        // A copy, so the editor's types written for the check stay out of the repository.
        const folder = join(scratch, name);
        cpSync(join(examples, name), folder, { recursive: true });
        EditorTypes.write(folder);
        writeFileSync(join(folder, "tsconfig.json"), EditorTypes.TSCONFIG);

        for (const [version, tsc] of [
            ["7", join(root, "node_modules", "typescript", "bin", "tsc")],
            ["6", join(root, "node_modules", "typescript-6", "bin", "tsc")],
        ] as const) {
            // TypeScript 6 can take longer than bun's five seconds on a slower machine.
            test(`the editor's types take it, in TypeScript ${version}`, () => {
                const run = spawnSync("bun", [tsc, "--noEmit", "-p", folder], { encoding: "utf8" });
                expect(run.stdout + run.stderr).toBe("");
            }, 30_000);
        }

        test("circuit validate finds nothing", async () => {
            const read = await readProject(folder);
            const findings = read.networks.flatMap((network) => Validation.run(Object.values(network.devices), network.settings.checks));

            expect(read.warnings).toEqual([]);
            expect(findings).toEqual([]);
        });
    });
}
