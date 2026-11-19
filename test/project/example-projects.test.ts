// The example projects in examples/, which the docs and the Academy show.

import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Checks } from "../../src/checks";
import { EditorTypes } from "../../src/cli/editor-types";
import { Project } from "../../src/project";

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
            const read = await Project.read(folder);
            const findings = read.networks.flatMap((network) => Checks.run(Object.values(network.devices), network.settings.checks));

            expect(read.warnings).toEqual([]);
            expect(findings).toEqual([]);
        });
    });
}

// The colocation once its last tenant has left: the devices still find tenants.parts and tenants.rules.
describe("colocation with no tenant", () => {
    const folder = join(scratch, "colocation-no-tenant");
    cpSync(join(examples, "colocation"), folder, { recursive: true });
    const index = join(folder, "tenants", "index.ts");
    const withTsukaeru = readFileSync(index, "utf8");
    const withoutTsukaeru = withTsukaeru
        .replace('import { tsukaeru } from "./tsukaeru";\n\n', "")
        .replace("merge([empty, tsukaeru])", "merge([empty])");
    writeFileSync(index, withoutTsukaeru);
    EditorTypes.write(folder);
    writeFileSync(join(folder, "tsconfig.json"), EditorTypes.TSCONFIG);

    test("the editor's types take it", () => {
        expect(withoutTsukaeru).not.toContain("tsukaeru");

        const run = spawnSync("bun", [join(root, "node_modules", "typescript", "bin", "tsc"), "--noEmit", "-p", folder], {
            encoding: "utf8",
        });
        expect(run.stdout + run.stderr).toBe("");
    }, 30_000);

    test("circuit validate finds nothing", async () => {
        const read = await Project.read(folder);
        const findings = read.networks.flatMap((network) => Checks.run(Object.values(network.devices), network.settings.checks));

        expect(findings).toEqual([]);
        expect(JSON.stringify(read.networks[0]!.devices)).not.toContain("tsukaeru");
    });
});

// The internet exchange once its last member has left: the switches still find members.parts.
describe("internet exchange with no member", () => {
    const folder = join(scratch, "internet-exchange-no-member");
    cpSync(join(examples, "internet-exchange"), folder, { recursive: true });
    const index = join(folder, "members", "index.ts");
    const withMembers = readFileSync(index, "utf8");
    const withoutMembers = withMembers
        .replace('import { cloudflare } from "./cloudflare";\nimport { google } from "./google";\n\n', "")
        .replace("merge([empty, cloudflare, google])", "merge([empty])");
    writeFileSync(index, withoutMembers);
    EditorTypes.write(folder);
    writeFileSync(join(folder, "tsconfig.json"), EditorTypes.TSCONFIG);

    test("the editor's types take it", () => {
        expect(withoutMembers).not.toContain("cloudflare");
        expect(withoutMembers).not.toContain("google");

        const run = spawnSync("bun", [join(root, "node_modules", "typescript", "bin", "tsc"), "--noEmit", "-p", folder], {
            encoding: "utf8",
        });
        expect(run.stdout + run.stderr).toBe("");
    }, 30_000);

    test("circuit validate finds nothing", async () => {
        const read = await Project.read(folder);
        const findings = read.networks.flatMap((network) => Checks.run(Object.values(network.devices), network.settings.checks));

        expect(findings).toEqual([]);
        expect(JSON.stringify(read.networks[0]!.devices)).not.toContain("Cloudflare, AS13335");
        expect(JSON.stringify(read.networks[0]!.devices)).not.toContain("Google, AS15169");
    });
});
