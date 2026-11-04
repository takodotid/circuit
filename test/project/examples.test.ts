// The devices of Circuit 0.x's examples, written as a v1 project (one network per example, one file per device, each `<network>.device({...})`): the editor's types take
// every one, Circuit reads the project, and each device comes out of it in the model exactly as written.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EditorTypes } from "../../src/cli/editor-types";
import { type ProjectRead, readProject } from "../../src/project/project";
import { Fixtures } from "../fixtures";

const folder = mkdtempSync(join(tmpdir(), "circuit-examples-"));
let read: ProjectRead;

beforeAll(async () => {
    const names = Fixtures.names();
    const sites = [...new Set(names.map((name) => name.split("--")[0]!))];

    // One network per example, as two examples may name a device alike. Each network's one site is the example.
    const network = (site: string) => site.replaceAll("-", "_");
    writeFileSync(
        join(folder, "circuit.ts"),
        sites
            .map((site) => `export const ${network(site)} = circuit({ asn: 64500, sites: { "${site}": { description: "${site}" } } });\n`)
            .join("")
    );

    for (const name of names) {
        const [site, device] = name.split("--") as [string, string];
        mkdirSync(join(folder, "sites", site), { recursive: true });
        writeFileSync(
            join(folder, "sites", site, `${device}.ts`),
            `import { ${network(site)} } from "../../circuit";\n\nexport default ${network(site)}.device(${JSON.stringify(Fixtures.device(name), null, 4)});\n`
        );
    }

    // Each certificate file, where its device names it.
    cpSync(Fixtures.FOLDER, folder, { recursive: true, filter: (source) => !/\.(json|txt)$/.test(source) });

    EditorTypes.write(folder);
    writeFileSync(join(folder, "tsconfig.json"), EditorTypes.TSCONFIG);
    read = await readProject(folder);
});

afterAll(() => rmSync(folder, { recursive: true, force: true }));

// TypeScript 7, and TypeScript 6, which VS Code bundles: the editor checks a project with its own TypeScript, whatever the project has.
for (const [version, tsc] of [
    ["7", join(import.meta.dir, "..", "..", "node_modules", "typescript", "bin", "tsc")],
    ["6", join(import.meta.dir, "..", "..", "node_modules", "typescript-6", "bin", "tsc")],
] as const) {
    // TypeScript 6 can take longer than bun's five seconds on a slower machine.
    test(`the editor's types take every device, in TypeScript ${version}`, () => {
        const run = spawnSync("bun", [tsc, "--noEmit", "-p", folder], { encoding: "utf8" });
        expect(run.stdout + run.stderr).toBe("");
    }, 30_000);
}

describe("each device is in the model as written", () => {
    for (const name of Fixtures.names()) {
        test(name, () => {
            const device = Fixtures.device(name);
            const network = read.networks.find((n) => n.name === name.split("--")[0]!.replaceAll("-", "_"))!;
            expect(network.devices[device.name]).toEqual(device);
        });
    }
});
