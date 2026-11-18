// Each ```ts block in docs/ and README.md type-checks with the language in src/config, so a page can't keep a key Circuit renamed or removed.

import { afterAll, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { EditorTypes } from "../src/cli/editor-types";

const root = join(import.meta.dir, "..");
// The real path, as tsc names the files of its errors from it: on macOS the temporary folder is behind a link.
const scratch = realpathSync(mkdtempSync(join(tmpdir(), "circuit-docs-")));
const tsc = join(root, "node_modules", "typescript", "bin", "tsc");

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** Where a block goes, on its first line: `// circuit.ts`, `// edge-01.ts, in routing.bgp`, or `// In monitoring`. */
const LOCATION = /^(?:\/\/ ([\w./-]+\.ts)?,? ?(?:[Ii]n ([\w-]+(?:\.[\w-]+)*))?)?/;
const WRITE_LOCATION =
    "If the block is not the top level of a device, start it with where it goes: `// edge-01.ts, in routing.bgp`, or `// circuit.ts`.";

/** What a block of circuit.ts is checked as: `circuit()`'s settings, inferred as `circuit()` infers them, with `sites` left out. */
const NETWORK = `declare function network<
    const Sites extends Readonly<Record<string, import("circuit").Site>> = {},
    const Own = {},
    const C = undefined,
    const P extends import("circuit").Prefixes = {},
>(settings: Partial<import("circuit").NetworkSettings<Sites, number, Own, C, P>>): void;
`;

/** A page's device file imports `as64500` from `circuit.ts`. A page that doesn't show `circuit.ts` gets this one, which takes any site. */
const ANY_NETWORK = `export const as64500 = circuit({ asn: 64500, sites: {} as Record<string, import("circuit").Site> });\n`;

/** A block, in the file tsc checks. A fragment's file has one line before the block. */
type Block = { page: string; line: number; fragment: boolean; located: boolean };

/** Each file tsc checks, by its path in `scratch`. */
const blocks = new Map<string, Block>();

const pages = spawnSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "docs/*.md", "README.md"], {
    cwd: root,
    encoding: "utf8",
})
    .stdout.split("\n")
    .filter(Boolean);

function write(file: string, text: string) {
    mkdirSync(dirname(join(scratch, file)), { recursive: true });
    writeFileSync(join(scratch, file), text);
}

/** Writes each block of `page` into its folder: a whole file at its path, so its imports work, and a fragment inside the type at its location. */
function writePage(page: string): string[] {
    const text = readFileSync(join(root, page), "utf8");
    const wrong: string[] = [];
    const files = new Set<string>();

    for (const match of text.matchAll(/^```ts\b.*\n([\s\S]*?)^```$/gm)) {
        const line = text.slice(0, match.index).split("\n").length;
        const code = match[1]!;
        const [, file, path] = LOCATION.exec(code)!;
        const body = code.replace(/^(\/\/.*)?\n/gm, "");

        if (/^(import|export) /.test(body)) {
            const name = file ?? `${line}.ts`;
            if (files.has(name)) wrong.push(`${page}:${line + 1}: a block above is ${name} too. Show the file once.`);
            files.add(name);
            write(`${page}/${name}`, code);
            blocks.set(`${page}/${name}`, { page, line, fragment: false, located: true });
            continue;
        }

        // A block that starts with `{` is items of a list. Any other block is keys of a map.
        const list = body.startsWith("{");
        let start: string;
        if (file === "circuit.ts") {
            if (path || list) {
                wrong.push(`${page}:${line + 1}: a block of circuit.ts is checked at its top level. Write \`// circuit.ts\` alone.`);
                continue;
            }
            start = "network({";
        } else {
            if (list && !path) {
                wrong.push(`${page}:${line + 1}: say which list these items go in: \`// edge-01.ts, in routing.policies.transit-import\`.`);
                continue;
            }
            // `Extract<..., object>` steps past what a field takes besides a map, such as `true` in `ssh: true`.
            const type = (path ?? "")
                .split(".")
                .filter(Boolean)
                .reduce((at, key) => `Extract<${at}, object>[${JSON.stringify(key)}]`, `import("circuit").DevicePart`);
            start = list ? `export const fragment: ${type} = [` : `export const fragment: Partial<${type}> = {`;
        }
        const end = `${list ? "]" : "}"}${file === "circuit.ts" ? ")" : ""};\n`;
        write(`${page}/${line}.ts`, `${start}\n${code}${end}`);
        blocks.set(`${page}/${line}.ts`, { page, line, fragment: true, located: Boolean(file || path) });
    }

    if (!files.has("circuit.ts")) write(`${page}/circuit.ts`, ANY_NETWORK);
    return wrong;
}

test("every ts block in docs/ and README.md type-checks", () => {
    EditorTypes.write(scratch);
    writeFileSync(join(scratch, "tsconfig.json"), EditorTypes.TSCONFIG);
    writeFileSync(join(scratch, "network.d.ts"), NETWORK);
    const wrong = pages.flatMap(writePage);

    const run = spawnSync("bun", [tsc, "--noEmit", "--pretty", "false", "-p", scratch], { cwd: scratch, encoding: "utf8" });
    // `file(line,column): error TS2353: message`, and the lines of the message below it, indented.
    const errors = [...(run.stdout + run.stderr).matchAll(/^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*(?:\n {2}.*)*)/gm)];
    if (run.status !== 0 && errors.length === 0) wrong.push(run.stdout + run.stderr);

    for (const [, file, at, column, code, message] of errors) {
        const block = blocks.get(file!);
        if (!block) {
            wrong.push(`${file}:${at}:${column}: ${code}: ${message}`);
            continue;
        }
        // A sample may use a file the page doesn't show, and its keys are still checked. A fragment may use a name its file imports, such as `home` from site.ts. A whole file may import a module other than circuit.ts, such as README.md's site.ts.
        if (block.fragment ? code === "TS2304" : code === "TS2307" && !message!.includes("circuit'")) continue;
        // An error on a fragment's first line, which tsc checks before the block, is about the location on the block's first line.
        const where =
            block.fragment && at === "1" ? `${block.line + 1}` : `${block.line + Number(at) - (block.fragment ? 1 : 0)}:${column}`;
        wrong.push(`${block.page}:${where}: ${code}: ${message}${block.located ? "" : `\n  ${WRITE_LOCATION}`}`);
    }

    expect(wrong).toEqual([]);
}, 30_000);
