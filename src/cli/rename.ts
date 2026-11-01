// `circuit rename`: a device's new name everywhere the project's files write it, and, when asked, its file too. It shows every change first and writes only once the person says yes.

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

export class Rename {
    /** Folders that hold none of the project's own files. */
    private static readonly SKIPPED = new Set(["node_modules", ".git", ".circuit", "dist"]);

    /** A hostname: letters, digits, dots, dashes and underscores. */
    static readonly HOSTNAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

    private static escape(text: string): string {
        return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }

    /** Every TypeScript file of the project, relative to its folder, in name order. */
    static sources(root: string, directory = root): string[] {
        const entries = readdirSync(directory, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

        return entries.flatMap((entry) => {
            if (entry.isDirectory()) return Rename.SKIPPED.has(entry.name) ? [] : Rename.sources(root, join(directory, entry.name));
            return /\.(ts|mts|cts)$/.test(entry.name) && !entry.name.endsWith(".d.ts") ? [relative(root, join(directory, entry.name))] : [];
        });
    }

    /**
     * Plan renaming a device from `from` to `to` in the project at `root`, whose file `declaring` writes it.
     *
     * A string that is exactly the old name becomes the new name: `name: "edge-01"`, `link: { device: "edge-01", ... }`, a check's list of devices, and a key such as a part's ports by device, which would otherwise no longer be found. A BGP neighbor named after the device is renamed too, which renames its session on the device: `circuit diff` shows it.
     */
    static plan(root: string, from: string, to: string, options: { declaring: string; file: boolean }): RenamePlan {
        const changes: LineChange[] = [];
        const moves: RenamePlan["moves"] = [];

        const exact = new RegExp(`(["'\`])${Rename.escape(from)}\\1`, "g");
        const anywhere = new RegExp(`(^|[^A-Za-z0-9_.-])${Rename.escape(from)}(?![A-Za-z0-9_-])`);
        const sources = Rename.sources(root);

        for (const file of sources) {
            const lines = readFileSync(join(root, file), "utf8").split("\n");

            for (const [index, before] of lines.entries()) {
                const after = before.replace(exact, (_match, quote: string) => `${quote}${to}${quote}`);
                if (after !== before) changes.push({ file, line: index + 1, before, after });
            }
        }

        if (options.file) {
            const target = join(dirname(options.declaring), `${to}${extname(options.declaring)}`);
            if (existsSync(join(root, target))) throw new Error(`${target} already exists`);

            moves.push({ from: options.declaring, to: target });
            changes.push(...Rename.importChanges(root, sources, options.declaring, target, changes));
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
    private static importChanges(root: string, sources: string[], file: string, target: string, earlier: LineChange[]): LineChange[] {
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
    static apply(root: string, plan: RenamePlan): void {
        const files = new Set(plan.changes.map((change) => change.file));

        for (const file of files) {
            const lines = readFileSync(join(root, file), "utf8").split("\n");
            for (const change of plan.changes.filter((each) => each.file === file)) lines[change.line - 1] = change.after;
            writeFileSync(join(root, file), lines.join("\n"));
        }

        for (const move of plan.moves) renameSync(join(root, move.from), join(root, move.to));
    }
}
