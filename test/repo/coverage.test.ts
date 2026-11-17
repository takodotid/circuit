// design/coverage.md keeps up with the config: each Key cell holds keys Circuit takes, a feature the model has lists its keys, and every key has a row.

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEVICE, NETWORK, type Shape } from "../../src/config/keys";

const FILE = "design/coverage.md";

/** One row of a table with a Key column: its first cell, its "In v1 model" cell when the table has one, and the paths in its Key cell. */
type Row = { feature: string; model?: string; key: string; paths: string[] };

/** Every row of every table in the file that has a Key column. */
function rows(): Row[] {
    const lines = readFileSync(join(import.meta.dir, "..", "..", FILE), "utf8").split("\n");
    const found: Row[] = [];
    let header: string[] = [];

    for (const line of lines) {
        if (!line.startsWith("|")) {
            header = [];
            continue;
        }

        const cells = line
            .split("|")
            .slice(1, -1)
            .map((cell) => cell.trim());

        if (!header.length) {
            header = cells;
            continue;
        }

        const key = cells[header.indexOf("Key")];
        if (key === undefined || cells[0]!.startsWith("---")) continue;

        const paths = [...key.matchAll(/`([^`]+)`/g)].map((match) => match[1]!);
        const model = header.includes("In v1 model") ? cells[header.indexOf("In v1 model")] : undefined;
        found.push({ feature: cells[0]!, model, key, paths });
    }

    return found;
}

/** The map a shape holds, a list's item for a list, or undefined for a plain value. */
function mapOf(shape: Shape | undefined): { readonly [key: string]: Shape } | undefined {
    const inner = Array.isArray(shape) ? (shape as readonly [Shape])[0] : shape;
    return inner === 0 || inner === undefined ? undefined : (inner as { readonly [key: string]: Shape });
}

/** The shape at a path, or undefined when there is no such key. `circuit.` walks the network, anything else a device. */
function shapeAt(path: string): Shape | undefined {
    const keys = path.split(".");
    let shape: Shape | undefined = keys[0] === "circuit" ? NETWORK : DEVICE;
    if (keys[0] === "circuit") keys.shift();

    for (const key of keys) {
        const map = mapOf(shape);
        shape = map && Object.hasOwn(map, key) ? map[key] : undefined;
    }

    return shape;
}

/**
 * The keys at or under `path` that no listed path covers, each as high up as nothing under it is listed. A listed path covers what is
 * under it, except a map of names whose entries hold keys (`interfaces.ethernet`, `system.users`): that one stands for the names alone,
 * and each entry's keys are written with `*`, such as `interfaces.ethernet.*.mtu`.
 */
function unlisted(shape: Shape, path: string, listed: readonly string[]): string[] {
    const map = mapOf(shape);
    const names = map !== undefined && Object.hasOwn(map, "*") && map["*"] !== 0;

    if (listed.includes(path) && !names) return [];
    if (!map || !listed.some((p) => p === path || p.startsWith(`${path}.`))) return [path];
    return Object.entries(map).flatMap(([key, below]) => unlisted(below, `${path}.${key}`, listed));
}

test("each path in a Key cell is a key Circuit takes", () => {
    const wrong = rows().flatMap(({ feature, key, paths }) => {
        if (key !== "-" && paths.map((path) => `\`${path}\``).join(", ") !== key)
            return [`${FILE}: the Key of "${feature}" is ${key}. Write - or paths in backticks, separated by commas.`];

        return paths
            .filter((path) => shapeAt(path) === undefined)
            .map((path) => `${FILE}: \`${path}\` in the row "${feature}" is no key in src/config/keys.ts. Fix the path or remove it.`);
    });

    expect(wrong).toEqual([]);
});

test("a feature the model has lists its keys, and one it lacks lists none", () => {
    const wrong = rows().flatMap(({ feature, model, paths }) => {
        if (model === undefined) return [];
        if (!["yes", "partial", "no", "n/a"].includes(model))
            return [`${FILE}: "${feature}" is "${model}" in the model. Write yes, partial, no or n/a.`];
        if ((model === "yes" || model === "partial") && !paths.length)
            return [`${FILE}: "${feature}" is ${model} in the model but has no Key. Write the keys that configure it.`];
        if ((model === "no" || model === "n/a") && paths.length)
            return [`${FILE}: "${feature}" is ${model} in the model but has a Key. Write yes or partial, or - as its Key.`];
        return [];
    });

    expect(wrong).toEqual([]);
});

test("every key Circuit takes has a row", () => {
    const listed = rows().flatMap((row) => row.paths);
    const missing = [
        ...Object.entries(DEVICE).flatMap(([key, shape]) => unlisted(shape, key, listed)),
        ...unlisted(NETWORK, "circuit", listed),
    ];

    expect(
        missing.map((path) => `${FILE}: \`${path}\` has no row. Add it to the row of the feature it configures, or to Circuit's own keys.`)
    ).toEqual([]);
});
