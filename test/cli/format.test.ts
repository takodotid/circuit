// `circuit fmt` writes a project's files in Circuit's style, or with --check only says which are not.

import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Format } from "../../src/cli/format";

let root = "";
afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = "";
});

const messy = "export const as64500 = circuit({asn:64500,sites:{\"site-a\":{description:'Jakarta'}}})\n";

test("a file comes out in Circuit's style: four spaces, double quotes, semicolons", async () => {
    const out = await Format.text(messy, "circuit.ts", Format.STYLE);
    expect(out).toBe('export const as64500 = circuit({ asn: 64500, sites: { "site-a": { description: "Jakarta" } } });\n');
});

test("a project's .prettierrc.json changes the style", async () => {
    root = mkdtempSync(join(tmpdir(), "circuit-fmt-"));
    writeFileSync(join(root, ".prettierrc.json"), JSON.stringify({ singleQuote: true }));

    const out = await Format.text(messy, "circuit.ts", Format.style(root));
    expect(out).toContain("'site-a'");
});

test("fmt writes every TypeScript file of the project, and leaves .circuit alone", async () => {
    root = mkdtempSync(join(tmpdir(), "circuit-fmt-"));
    mkdirSync(join(root, "sites", "site-a"), { recursive: true });
    mkdirSync(join(root, ".circuit", "types"), { recursive: true });
    writeFileSync(join(root, "circuit.ts"), messy);
    writeFileSync(join(root, ".circuit", "types", "x.ts"), messy);

    expect(Format.files(root).map((file) => file.replaceAll("\\", "/"))).toEqual(["circuit.ts"]);

    await Format.run(root, [], false);
    expect(readFileSync(join(root, "circuit.ts"), "utf8")).toContain('{ asn: 64500, sites: { "site-a": { description: "Jakarta" } } }');
    expect(readFileSync(join(root, ".circuit", "types", "x.ts"), "utf8")).toBe(messy);
});
