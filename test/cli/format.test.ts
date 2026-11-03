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

test("a file comes out in the style of a new project's .editorconfig: four spaces, double quotes, semicolons", async () => {
    root = mkdtempSync(join(tmpdir(), "circuit-fmt-"));
    writeFileSync(join(root, ".editorconfig"), Format.EDITORCONFIG);

    expect(Format.style(root)).toEqual({ useTabs: false, tabWidth: 4, printWidth: 140, endOfLine: "lf" });
    const out = await Format.text(messy, "circuit.ts", Format.style(root));
    expect(out).toBe('export const as64500 = circuit({ asn: 64500, sites: { "site-a": { description: "Jakarta" } } });\n');
});

test("only the sections that apply to a TypeScript file count", () => {
    const settings = Format.editorconfig(
        "root = true\n[*]\nindent_size = 2\n[*.md]\nindent_size = 8\n[*.{ts,json}]\nmax_line_length = 100 # comment\n"
    );
    expect(settings).toEqual({ indent_size: "2", max_line_length: "100" });
});

test("a project's .prettierrc.json goes on top", async () => {
    root = mkdtempSync(join(tmpdir(), "circuit-fmt-"));
    writeFileSync(join(root, ".prettierrc.json"), JSON.stringify({ singleQuote: true }));

    const out = await Format.text(messy, "circuit.ts", Format.style(root));
    expect(out).toContain("'site-a'");
});

test("fmt writes every TypeScript file of the project, and leaves .circuit alone", async () => {
    root = mkdtempSync(join(tmpdir(), "circuit-fmt-"));
    mkdirSync(join(root, "sites", "site-a"), { recursive: true });
    mkdirSync(join(root, ".circuit", "types"), { recursive: true });
    writeFileSync(join(root, ".editorconfig"), Format.EDITORCONFIG);
    writeFileSync(join(root, "circuit.ts"), messy);
    writeFileSync(join(root, ".circuit", "types", "x.ts"), messy);

    expect(Format.files(root).map((file) => file.replaceAll("\\", "/"))).toEqual(["circuit.ts"]);

    await Format.run(root, [], false);
    expect(readFileSync(join(root, "circuit.ts"), "utf8")).toContain('{ asn: 64500, sites: { "site-a": { description: "Jakarta" } } }');
    expect(readFileSync(join(root, ".circuit", "types", "x.ts"), "utf8")).toBe(messy);
});
