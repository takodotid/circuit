// `circuit rename`: a device's new name everywhere the project's files name it, its snapshot renamed to match, and with `--file` its file too. It plans first and writes only with --confirm.

import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";

/** One line that changes. */
export type LineChange = { file: string; line: number; before: string; after: string };

export type RenamePlan = {
    changes: LineChange[];
    /** Files that move, from and to, relative to the project. */
    moves: { from: string; to: string }[];
    /** Lines that still name the device inside a longer text, such as a description or a comment, which the rename leaves alone. */
    mentions: { file: string; line: number; text: string }[];
};

/** Directories that hold no config of the project's own. */
const SKIPPED = new Set(["node_modules", ".git", ".circuit", "dist"]);

/** Every TypeScript file of the project, relative to its root, in name order. */
function sourcesOf(root: string, directory = root): string[] {
    const entries = readdirSync(directory, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

    return entries.flatMap((entry) => {
        if (entry.isDirectory()) return SKIPPED.has(entry.name) ? [] : sourcesOf(root, join(directory, entry.name));
        return /\.(ts|mts|cts)$/.test(entry.name) ? [relative(root, join(directory, entry.name))] : [];
    });
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Plan renaming a device from `from` to `to` in the project at `root`.
 *
 * A string that is exactly the old name becomes the new name: `name: "edge-01"`, `link: { device: "edge-01", ... }`, a check's list of routers, and a key such as a tenant's ports by device, which would otherwise no longer be found. A BGP neighbor named after the device is renamed too, which renames its session on the device: `circuit diff` shows it.
 */
export function planRename(root: string, from: string, to: string, options: { file: boolean; snapshots: string[] }): RenamePlan {
    const changes: LineChange[] = [];
    const moves: RenamePlan["moves"] = [];

    const exact = new RegExp(`(["'\`])${escape(from)}\\1`, "g");
    const anywhere = new RegExp(`(^|[^A-Za-z0-9_.-])${escape(from)}(?![A-Za-z0-9_-])`);
    const declares = new RegExp(`\\bname\\s*:\\s*(["'\`])${escape(from)}\\1`);

    const sources = sourcesOf(root);
    const declaring = new Set<string>();

    for (const file of sources) {
        const text = readFileSync(join(root, file), "utf8");
        const lines = text.split("\n");

        // The device's own file calls defineDevice and gives it the name.
        if (text.includes("defineDevice") && declares.test(text)) declaring.add(file);

        for (const [index, before] of lines.entries()) {
            const after = before.replace(exact, (_match, quote: string) => `${quote}${to}${quote}`);
            if (after !== before) changes.push({ file, line: index + 1, before, after });
        }
    }

    if (!declaring.size) {
        throw new Error(
            `no file declares name: "${from}"; the name may be built from parts, such as a template string, so rename it by hand`
        );
    }

    for (const snapshot of options.snapshots) {
        moves.push({ from: snapshot, to: join(dirname(snapshot), `${to}${extname(snapshot)}`) });
    }

    if (options.file) {
        if (declaring.size > 1) throw new Error(`${[...declaring].join(" and ")} both declare name: "${from}"; rename the file by hand`);

        const [file] = [...declaring] as [string];
        const target = join(dirname(file), `${to}${extname(file)}`);
        if (existsSync(join(root, target))) throw new Error(`${target} already exists`);

        moves.push({ from: file, to: target });
        changes.push(...importChanges(root, sources, file, target, changes));
    }

    // What still names the device once every change is made.
    const mentions = sources.flatMap((file) =>
        readFileSync(join(root, file), "utf8")
            .split("\n")
            .flatMap((original, index) => {
                const text = changes.find((change) => change.file === file && change.line === index + 1)?.after ?? original;
                return anywhere.test(text) ? [{ file, line: index + 1, text: text.trim() }] : [];
            })
    );

    return { changes, moves, mentions };
}

/** Imports of a file that moves, pointed at its new name. Lines already changed are changed further. */
function importChanges(root: string, sources: string[], file: string, target: string, earlier: LineChange[]): LineChange[] {
    const result: LineChange[] = [];
    const withoutExtension = (path: string) => path.replace(/\.(ts|mts|cts|js|mjs|cjs)$/, "");
    const moved = withoutExtension(resolve(root, file));

    for (const source of sources) {
        const lines = readFileSync(join(root, source), "utf8").split("\n");

        for (const [index, original] of lines.entries()) {
            const line = index + 1;
            const changed = earlier.find((change) => change.file === source && change.line === line);
            const before = changed?.after ?? original;

            // A relative specifier that resolves to the moved file keeps its own form, extension or not.
            const after = before.replace(
                /(\bfrom\s+|\bimport\s*\(\s*)(["'])(\.{1,2}\/[^"']+)\2/g,
                (match, lead: string, quote: string, specifier: string) => {
                    if (withoutExtension(resolve(root, dirname(source), specifier)) !== moved) return match;

                    const extension = specifier.match(/\.(ts|mts|cts|js|mjs|cjs)$/)?.[0] ?? "";
                    const renamed = `${dirname(specifier)}/${basename(withoutExtension(target))}${extension}`;
                    return `${lead}${quote}${renamed}${quote}`;
                }
            );

            if (after === before) continue;

            if (changed) changed.after = after;
            else result.push({ file: source, line, before: original, after });
        }
    }

    return result;
}

/** Write the plan: each changed line, then each move. */
export function applyRename(root: string, plan: RenamePlan): void {
    const files = new Set(plan.changes.map((change) => change.file));

    for (const file of files) {
        const lines = readFileSync(join(root, file), "utf8").split("\n");
        for (const change of plan.changes.filter((each) => each.file === file)) lines[change.line - 1] = change.after;
        writeFileSync(join(root, file), lines.join("\n"));
    }

    for (const move of plan.moves) renameSync(join(root, move.from), join(root, move.to));
}
