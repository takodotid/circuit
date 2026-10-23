// Convergence for platforms whose configuration is a list of lines in nested blocks, such as `interface X` holding its settings. A line the render does not hold is undone, so the device ends up holding exactly the render.

import type { Plan, Step } from "./types";

export type Dialect = {
    /** A line at the margin that opens a block, for platforms that do not indent a block's lines. */
    block: RegExp;
    /** Whether a block's lines are indented under it. When they are, any line followed by deeper lines opens a block. */
    indented: boolean;
    /** A line at the margin that closes every open block. */
    terminator: string;
    /** Lines that describe the device rather than configure it, or that the platform prints whatever is set. */
    ignore: (line: string) => boolean;
    /** The command that removes a line. */
    undo: (line: string) => string;
    /** Leaves one level of block. */
    leave: string;
    /** Lines sent before the undos of their block, because the platform refuses an undo until they are in place. */
    first?: RegExp;
    /** A line in the form both sides compare in, for example a secret the device prints as a cipher. */
    canon?: (line: string) => string;
    /** Where a block is sent among the others, lowest first, so that nothing is referenced before it exists. In the order they differ when absent. */
    order?: (path: string[]) => number;
};

/** One line, with the blocks it sits in, outermost first. */
export type Entry = { path: string[]; line: string };

/** How deep a line is indented. */
const indentOf = (raw: string) => raw.length - raw.trimStart().length;

export function entries(text: string, dialect: Dialect): Entry[] {
    const lines = text
        .replace(/\r/g, "")
        .split("\n")
        .filter((raw) => raw.trim() !== "");
    const result: Entry[] = [];
    const open: { indent: number; header: string }[] = [];

    for (let i = 0; i < lines.length; i++) {
        const raw = lines[i]!;
        const indent = indentOf(raw);
        const line = raw.trim().replace(/\s+/g, " ");

        if (line === dialect.terminator) {
            if (indent === 0) open.length = 0;
            continue;
        }

        if (dialect.ignore(line)) continue;

        if (dialect.indented) {
            while (open.length && open.at(-1)!.indent >= indent) open.pop();
        } else if (indent === 0 && dialect.block.test(line)) {
            open.length = 0;
        }

        result.push({ path: open.map((block) => block.header), line });

        const isContent = (candidate: string) => candidate.trim() !== dialect.terminator && !dialect.ignore(candidate.trim());
        const nextLine = lines.slice(i + 1).find(isContent);

        const opensBlock = dialect.indented
            ? nextLine !== undefined && indentOf(nextLine) > indent
            : indent === 0 && dialect.block.test(line);

        if (opensBlock) open.push({ indent, header: line });
    }

    return result;
}

/** The part of a line that names what it sets: `rule 5`, a free-text keyword, or the line up to its value. Two lines with one head are one setting with two values. */
export function head(line: string): string {
    const rule = /^rule \d+/.exec(line);
    if (rule) return rule[0];

    if (/^(description|name) /.test(line)) return line.split(" ")[0]!;

    const words = line.split(" ");
    return words.slice(0, Math.max(1, words.length - 1)).join(" ");
}

/** What changes inside one block. */
export type Group = { path: string[]; remove: string[]; add: string[] };

/**
 * What differs, by block.
 *
 * A device line replaced by a desired line with the same head is not undone; sending the new one is enough. A block the render does not hold goes with its header, and its lines with it.
 */
export function compare(desired: string, current: string, dialect: Dialect): Group[] {
    const canon = dialect.canon ?? ((line: string) => line);
    const keyOf = (entry: Entry) => [...entry.path, canon(entry.line)].join("\u0000");
    const pathKey = (path: string[]) => path.join("\u0000");

    const wanted = entries(desired, dialect);
    const existing = entries(current, dialect);
    const wantedKeys = new Set(wanted.map(keyOf));
    const existingKeys = new Set(existing.map(keyOf));
    const wantedBlocks = new Set(wanted.map((entry) => pathKey([...entry.path, entry.line])));

    const groups = new Map<string, Group>();
    const groupFor = (path: string[]) => {
        const key = pathKey(path);
        if (!groups.has(key)) groups.set(key, { path, remove: [], add: [] });
        return groups.get(key)!;
    };

    for (const entry of wanted) {
        if (existingKeys.has(keyOf(entry))) continue;

        // A header goes with its block's own step, never on its own.
        const ownBlock = pathKey([...entry.path, entry.line]);
        const opensBlock = wanted.some((other) => {
            const deeper = other.path.length > entry.path.length;
            return deeper && pathKey(other.path.slice(0, entry.path.length + 1)) === ownBlock;
        });
        if (opensBlock) continue;

        groupFor(entry.path).add.push(entry.line);
    }

    // Undone in reverse order, so a line is undone before the line it depends on.
    for (const entry of [...existing].reverse()) {
        if (wantedKeys.has(keyOf(entry))) continue;

        // Inside a block the render does not hold: undoing the header removes it.
        const insideRemovedBlock = entry.path.some((_, depth) => {
            const enclosing = pathKey(entry.path.slice(0, depth + 1));
            return !wantedBlocks.has(enclosing);
        });
        if (insideRemovedBlock) continue;

        const replaced = wanted.some((other) => {
            const sameBlock = pathKey(other.path) === pathKey(entry.path);
            const isNew = !existingKeys.has(keyOf(other));
            return sameBlock && isNew && head(other.line) === head(entry.line);
        });
        if (!replaced) groupFor(entry.path).remove.push(entry.line);
    }

    return [...groups.values()].filter((group) => group.add.length || group.remove.length);
}

/**
 * Replace a changed VLAN list line with only what changed.
 *
 * A platform keeps its VLANs as one line, such as `vlan batch 10 20 to 30`. Undoing the old line would delete VLANs still in use, so the plan adds the new IDs and removes the gone ones instead.
 */
export function vlanListChange(
    groups: Group[],
    prefix: string,
    parse: (line: string) => number[],
    format: (ids: number[]) => string[],
    removal: (ids: number[]) => string[]
): void {
    const top = groups.find((group) => group.path.length === 0);
    if (!top) return;

    const old = top.remove.find((line) => line.startsWith(prefix));
    const fresh = top.add.find((line) => line.startsWith(prefix));
    if (!old && !fresh) return;

    const before = old ? parse(old) : [];
    const after = fresh ? parse(fresh) : [];

    top.remove = top.remove.filter((line) => line !== old);
    top.add = top.add.filter((line) => line !== fresh);

    const added = after.filter((id) => !before.includes(id));
    const removed = before.filter((id) => !after.includes(id));

    // New VLANs exist before anything uses them; gone ones go after.
    if (added.length) top.add.unshift(...format(added));
    if (removed.length) top.remove.push(...removal(removed));
}

/** Commands a platform needs around one group, such as releasing a binding before a change and restoring it after. */
export type Around = (group: Group) => { before: string[]; after: string[] };

const nothingAround: Around = () => ({ before: [], after: [] });

/** The steps for the groups: enter each block of the path, undo, add, then leave each level. */
export function steps(groups: Group[], dialect: Dialect, around: Around = nothingAround): Plan["steps"] {
    const rank = dialect.order ?? (() => 0);
    const ordered = [...groups].sort((a, b) => rank(a.path) - rank(b.path));

    return ordered.map((group): Step => {
        const { before, after } = around(group);

        const early = group.add.filter((line) => dialect.first?.test(line));
        const late = group.add.filter((line) => !early.includes(line));

        // A block header sent on its own, such as an empty `bfd`, enters its view; it is left at once so the next line is not sent into it.
        const added = late.flatMap((line) => (dialect.block.test(line) ? [line, dialect.leave] : [line]));

        const inner = [...early, ...group.remove.map(dialect.undo), ...added];
        const leave = group.path.map(() => dialect.leave);

        return {
            title: group.path.join(" > ") || "(top level)",
            show: [...group.remove.map((line) => `- ${line}`), ...group.add.map((line) => `+ ${line}`)],
            send: [...before, ...group.path, ...inner, ...leave, ...after],
        };
    });
}

const STORED_CREDENTIAL = /(password (?:irreversible-)?cipher|community read cipher|^snmp-server community)( +)\S+/gm;

/** A device prints stored credentials as ciphers. They never leave the read. */
export const scrub = (text: string) => text.replace(STORED_CREDENTIAL, "$1$2<redacted>");
