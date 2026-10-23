// FortiOS configuration as a tree. A `config` block holds settings, nested blocks and, in a table, entries opened with `edit`. The render builds a tree and prints it in the form `show` prints, and the read parses what `show` printed, so the plan compares two trees.

/** One `edit` of a table: its name as written, and what it holds. */
export type Entry = { id: string; block: FortiOsBlock };

export class FortiOsBlock {
    readonly settings = new Map<string, string>();
    readonly blocks = new Map<string, FortiOsBlock>();
    readonly entries = new Map<string, Entry>();

    /** Set a key. A value of several words is written as given. */
    set(key: string, value: string | number): this {
        this.settings.set(key, String(value));
        return this;
    }

    /** The nested `config` block with this header, created when absent. */
    block(header: string): FortiOsBlock {
        if (!this.blocks.has(header)) this.blocks.set(header, new FortiOsBlock());
        return this.blocks.get(header)!;
    }

    /** The table entry with this name, created when absent. A name is quoted unless it is a number, or the table prints it bare, such as an OSPF area or an IPv6 prefix. */
    entry(id: string | number, plain = false): FortiOsBlock {
        const written = typeof id === "number" || plain ? String(id) : FortiOsTree.quote(id);
        const key = FortiOsTree.bare(written);
        if (!this.entries.has(key)) this.entries.set(key, { id: written, block: new FortiOsBlock() });
        return this.entries.get(key)!.block;
    }

    isEmpty(): boolean {
        return !this.settings.size && !this.blocks.size && !this.entries.size;
    }
}

export class FortiOsTree {
    /** A setting the device prints as `unset <key>`, a key it holds empty on purpose, such as an ICMP service's type. */
    static readonly UNSET = "\u0000unset";

    /** A string as the CLI takes it, in double quotes. */
    static quote(text: string): string {
        return `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
    }

    /** Each of several strings quoted, as a list setting takes them. */
    static quoteAll(texts: readonly string[]): string {
        return texts.map(FortiOsTree.quote).join(" ");
    }

    /** A value's words; a quoted string is one word with its quotes. */
    static words(value: string): string[] {
        return value.match(/"(?:[^"\\]|\\.)*"|'[^']*'|\S+/g) ?? [];
    }

    /** A word as the device means it, without quotes or escapes. */
    static bare(word: string): string {
        if (word.startsWith('"')) return word.slice(1, -1).replace(/\\(.)/g, "$1");
        if (word.startsWith("'")) return word.slice(1, -1);
        return word;
    }

    /** The lines that build a block, at an indent, in the form `show` prints and the CLI takes. */
    static lines(block: FortiOsBlock, indent = ""): string[] {
        const lines: string[] = [];

        for (const [key, value] of block.settings)
            lines.push(value === FortiOsTree.UNSET ? `${indent}unset ${key}` : `${indent}set ${key} ${value}`);

        for (const [header, child] of block.blocks)
            lines.push(`${indent}config ${header}`, ...FortiOsTree.lines(child, indent + "    "), `${indent}end`);

        for (const { id, block: entry } of block.entries.values()) {
            lines.push(`${indent}edit ${id}`, ...FortiOsTree.lines(entry, indent + "    "), `${indent}next`);
        }

        return lines;
    }

    /** The whole configuration: each top-level block as `config <section>` to `end`. */
    static print(root: FortiOsBlock): string {
        const lines: string[] = [];
        for (const [section, block] of root.blocks) lines.push(`config ${section}`, ...FortiOsTree.lines(block, "    "), "end");
        return lines.join("\n") + "\n";
    }

    /** Whether a line opens a quoted value it does not close, so the value goes on over the next lines. */
    private static unclosed(line: string): boolean {
        return (line.replace(/\\./g, "").match(/"/g)?.length ?? 0) % 2 === 1;
    }

    /** The tree of what `show` printed. Lines that are not configuration, such as the version header, are skipped. */
    static parse(text: string): FortiOsBlock {
        const root = new FortiOsBlock();
        const stack: { block: FortiOsBlock; isEntry: boolean }[] = [{ block: root, isEntry: false }];
        const lines = text.replace(/\r/g, "").split("\n");

        for (let index = 0; index < lines.length; index++) {
            let line = lines[index]!.trim();
            if (!line || line.startsWith("#")) continue;

            while (FortiOsTree.unclosed(line) && index + 1 < lines.length) line += "\n" + lines[++index];

            const current = stack.at(-1)!.block;
            const [verb] = line.split(/\s+/, 1);
            const rest = line.slice(verb!.length).trim();

            if (verb === "config") {
                const child = current.block(rest);
                stack.push({ block: child, isEntry: false });
            } else if (verb === "edit") {
                const key = FortiOsTree.bare(rest);
                if (!current.entries.has(key)) current.entries.set(key, { id: rest, block: new FortiOsBlock() });
                stack.push({ block: current.entries.get(key)!.block, isEntry: true });
            } else if (verb === "next") {
                if (stack.at(-1)!.isEntry) stack.pop();
            } else if (verb === "end") {
                if (stack.at(-1)!.isEntry) stack.pop();
                if (stack.length > 1) stack.pop();
            } else if (verb === "set") {
                const [key] = rest.split(/\s+/, 1);
                current.settings.set(key!, rest.slice(key!.length).trim());
            } else if (verb === "unset") {
                current.settings.set(rest, FortiOsTree.UNSET);
            }
        }

        return root;
    }
}
