// test/key-gaps.json may only shrink: against main, it gains no gap, except the keys inside a gap that is partly closed.

import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const FILE = "test/key-gaps.json";
const root = join(import.meta.dir, "..");

const git = (...args: string[]) => spawnSync("git", args, { cwd: root, encoding: "utf8" });

/** Each gap as its list and its key path, such as `platforms.routeros.silent` and `interfaces.bridge`. */
function gaps(json: string): { list: string; path: string }[] {
    const walk = (value: unknown, list: string): { list: string; path: string }[] =>
        Array.isArray(value)
            ? value.map((path: string) => ({ list, path }))
            : Object.entries(value as Record<string, unknown>).flatMap(([key, inner]) => walk(inner, list ? `${list}.${key}` : key));
    return walk(JSON.parse(json), "");
}

test("test/key-gaps.json gains no gap", () => {
    const base = git("merge-base", "HEAD", "origin/main").stdout.trim();
    // Without main to compare with, such as in a shallow clone, or before main has the file, there is nothing to compare.
    const before = base ? git("show", `${base}:${FILE}`) : undefined;
    if (!before || before.status !== 0) return;

    const listed = gaps(before.stdout);
    const inside = (list: string, path: string) =>
        listed.some(
            (gap) => gap.list === list && (gap.path === path || path.startsWith(`${gap.path}.`) || path.startsWith(`${gap.path}[`))
        );

    const added = gaps(readFileSync(join(root, FILE), "utf8"))
        .filter(({ list, path }) => !inside(list, path))
        .map(
            ({ list, path }) =>
                `${list}: ${path} is new since main. Close the gap instead: render or refuse the key, or write it in an example.`
        );

    expect(added).toEqual([]);
});
