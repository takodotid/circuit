// Renaming a device changes every string that is exactly its name, moves its snapshot and, when asked, its file, and leaves longer texts that mention it for a person to read.

import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyRename, planRename } from "../src/cli/rename";

let root = "";

/** A small project: the device lives in a file whose name is not its hostname. */
function project(): string {
    root = mkdtempSync(join(tmpdir(), "circuit-rename-"));

    const files: Record<string, string> = {
        "circuit.config.ts":
            'import edge from "./edge-01";\nimport access from "./switch.ts";\nexport default defineNetwork({ devices: [edge, access] });\n',
        "switch.ts":
            'export default defineDevice({\n    name: "tor-01",\n    ports: { "10g-1": { description: "Uplink", link: { device: "edge-01", port: "100g-1" } } },\n});\n',
        "edge-01.ts":
            'export default defineDevice({\n    name: \'edge-01\',\n    ports: { "100g-1": { description: "To tor-01", link: { device: \'tor-01\', port: "10g-1" } } },\n});\n',
        "sites/checks.ts": 'export default [trustBoundary({ untrusted: ["guests"], routers: ["edge-01"], switches: [`tor-01`] })];\n',
        "node_modules/other/index.ts": 'export const name = "tor-01";\n',
    };

    for (const [path, text] of Object.entries(files)) {
        mkdirSync(join(root, path, ".."), { recursive: true });
        writeFileSync(join(root, path), text);
    }

    mkdirSync(join(root, ".circuit/state"), { recursive: true });
    writeFileSync(join(root, ".circuit/state/tor-01.cfg"), "sysname tor-01\n");

    return root;
}

afterEach(() => rmSync(root, { recursive: true, force: true }));

test("every exact string takes the new name, in any quotes, outside node_modules", () => {
    const plan = planRename(project(), "tor-01", "rack-a-01", { file: false, snapshots: [join(".circuit", "state", "tor-01.cfg")] });

    expect(plan.changes.map((change) => [change.file.replaceAll("\\", "/"), change.line, change.after.trim()])).toEqual([
        ["edge-01.ts", 3, 'ports: { "100g-1": { description: "To tor-01", link: { device: \'rack-a-01\', port: "10g-1" } } },'],
        ["sites/checks.ts", 1, 'export default [trustBoundary({ untrusted: ["guests"], routers: ["edge-01"], switches: [`rack-a-01`] })];'],
        ["switch.ts", 2, 'name: "rack-a-01",'],
    ]);

    expect(plan.moves.map((move) => move.to.replaceAll("\\", "/"))).toEqual([".circuit/state/rack-a-01.cfg"]);
    expect(plan.mentions.map((mention) => mention.text)).toEqual([
        'ports: { "100g-1": { description: "To tor-01", link: { device: \'rack-a-01\', port: "10g-1" } } },',
    ]);
});

test("with file, the file that declares the device takes its name, and imports of it follow, in their own form", () => {
    const plan = planRename(project(), "tor-01", "rack-a-01", { file: true, snapshots: [] });

    expect(plan.moves.map((move) => [move.from, move.to])).toEqual([["switch.ts", "rack-a-01.ts"]]);
    expect(plan.changes.filter((change) => change.file === "circuit.config.ts").map((change) => change.after)).toEqual([
        'import access from "./rack-a-01.ts";',
    ]);

    applyRename(root, plan);

    expect(existsSync(join(root, "switch.ts"))).toBe(false);
    expect(readFileSync(join(root, "rack-a-01.ts"), "utf8")).toContain('name: "rack-a-01"');
    expect(readFileSync(join(root, "circuit.config.ts"), "utf8")).toContain(
        'import edge from "./edge-01";\nimport access from "./rack-a-01.ts";'
    );
});

test("applying moves the snapshot and leaves the rest of each file as it was", () => {
    const plan = planRename(project(), "tor-01", "rack-a-01", { file: false, snapshots: [join(".circuit", "state", "tor-01.cfg")] });
    applyRename(root, plan);

    expect(readFileSync(join(root, ".circuit/state/rack-a-01.cfg"), "utf8")).toBe("sysname tor-01\n");
    expect(readFileSync(join(root, "node_modules/other/index.ts"), "utf8")).toBe('export const name = "tor-01";\n');
    expect(readFileSync(join(root, "switch.ts"), "utf8").split("\n")).toHaveLength(5);
});

test("a name no file declares as written, or a file name already taken, stops the rename", () => {
    expect(() => planRename(project(), "core-01", "core-02", { file: false, snapshots: [] })).toThrow('no file declares name: "core-01"');

    writeFileSync(join(root, "rack-a-01.ts"), "");
    expect(() => planRename(root, "tor-01", "rack-a-01", { file: true, snapshots: [] })).toThrow("rack-a-01.ts already exists");
});
