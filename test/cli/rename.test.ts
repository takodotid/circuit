// Renaming a device changes every string that is exactly its name, moves its file when asked, and leaves longer texts that mention it for a person to read.

import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Rename } from "../../src/cli/rename";

let root = "";

/** A small project: two devices that link to each other, a site file, and a package that happens to hold the name. */
function project(): string {
    root = mkdtempSync(join(tmpdir(), "circuit-rename-"));

    const files: Record<string, string> = {
        "circuit.ts":
            'export const as64500 = circuit({ asn: 64500, sites: { "site-a": {} }, checks: { untrusted_vlans: { filtering_devices: ["edge-01"] } } });\n',
        "sites/site-a/tor-01.ts":
            'import { as64500 } from "../../circuit";\n\nexport default as64500.device({\n    name: "tor-01",\n    interfaces: { ethernet: { "10g-1": { description: "edge-01 sfp28-1", link: { device: "edge-01", port: "sfp28-1" } } } },\n});\n',
        "sites/site-a/edge-01.ts":
            'import { as64500 } from "../../circuit";\nimport { uplink } from "./tor-01";\n\nexport default as64500.device({\n    name: \'edge-01\',\n    interfaces: { ethernet: { "sfp28-1": { description: "tor-01 10GE1/0/1", link: { device: \'tor-01\', port: "10g-1" } } } },\n});\n',
        "lib/ports.ts": 'export const ports = { [`tor-01`]: ["10g-2"] };\n',
        "node_modules/other/index.ts": 'export const name = "tor-01";\n',
    };

    for (const [path, text] of Object.entries(files)) {
        mkdirSync(join(root, path, ".."), { recursive: true });
        writeFileSync(join(root, path), text);
    }

    return root;
}

afterEach(() => rmSync(root, { recursive: true, force: true }));

const slashes = (path: string) => path.replaceAll("\\", "/");

test("every exact string takes the new name, in any quotes, outside node_modules", () => {
    const plan = Rename.plan(project(), "tor-01", "rack-a-01", { declaring: join("sites", "site-a", "tor-01.ts"), file: false });

    expect(plan.changes.map((change) => [slashes(change.file), change.line])).toEqual([
        ["lib/ports.ts", 1],
        ["sites/site-a/edge-01.ts", 6],
        ["sites/site-a/tor-01.ts", 4],
    ]);
    expect(plan.changes[1]!.after).toContain("link: { device: 'rack-a-01', port: \"10g-1\" }");
    expect(plan.changes[1]!.after).toContain('description: "tor-01 10GE1/0/1"');
    expect(plan.moves).toEqual([]);

    // An import of the file, which keeps its name, and a description that names the device are a person's to change.
    expect(plan.mentions.map((mention) => [slashes(mention.file), mention.line])).toEqual([
        ["sites/site-a/edge-01.ts", 2],
        ["sites/site-a/edge-01.ts", 6],
    ]);
});

test("with file, the device's file takes the new name, and imports of it follow", () => {
    const plan = Rename.plan(project(), "tor-01", "rack-a-01", { declaring: join("sites", "site-a", "tor-01.ts"), file: true });

    expect(plan.moves.map((move) => [slashes(move.from), slashes(move.to)])).toEqual([
        ["sites/site-a/tor-01.ts", "sites/site-a/rack-a-01.ts"],
    ]);

    Rename.apply(root, plan);

    expect(existsSync(join(root, "sites/site-a/tor-01.ts"))).toBe(false);
    expect(readFileSync(join(root, "sites/site-a/rack-a-01.ts"), "utf8")).toContain('name: "rack-a-01"');
    expect(readFileSync(join(root, "sites/site-a/edge-01.ts"), "utf8")).toContain('import { uplink } from "./rack-a-01";');
    expect(readFileSync(join(root, "node_modules/other/index.ts"), "utf8")).toBe('export const name = "tor-01";\n');
});

test("a file already at the new name stops the rename", () => {
    project();
    writeFileSync(join(root, "sites/site-a/rack-a-01.ts"), "");

    expect(() => Rename.plan(root, "tor-01", "rack-a-01", { declaring: join("sites", "site-a", "tor-01.ts"), file: true })).toThrow(
        "already exists"
    );
});
