import type { Bfd } from "../../model";

/** Collects `set` statements, and the comments the plan reads. */
export class JunosStatements {
    /** BFD's interval when `routing.bfd` sets none, as the platform has no default: three missed packets 300 ms apart take under a second. Its multiplier is 3. */
    static readonly BFD_INTERVAL_MS = 300;

    private readonly lines: string[] = [];
    private readonly notes: string[] = [];

    /** A value as one word: quoted unless it is a plain word. Quoting more than the platform would is harmless, because the comparison ignores quotes. */
    static quote(value: string): string {
        if (/^[\w.:/@-]+$/.test(value)) return value;

        const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
        return `"${escaped}"`;
    }

    set(...words: (string | number)[]): void {
        this.lines.push(`set ${words.join(" ")}`);
    }

    /** BFD on a statement, with `routing.bfd`'s timers or the interval above. */
    bfd(statement: string, timers: Bfd | undefined): void {
        this.set(statement, "bfd-liveness-detection minimum-interval", timers?.interval ?? JunosStatements.BFD_INTERVAL_MS);
        if (timers) this.set(statement, "bfd-liveness-detection multiplier", timers.multiplier);
    }

    note(comment: string): void {
        this.notes.push(comment);
    }

    /** The statements as the device prints them: each once, and none that another one extends, because the platform prints only the longest. */
    text(): string {
        const unique = [...new Set(this.lines)];
        const extended = new Set<string>();

        for (const line of unique) {
            const words = line.split(" ");
            for (let length = 2; length < words.length; length++) extended.add(words.slice(0, length).join(" "));
        }

        return `${[...unique.filter((line) => !extended.has(line)), ...this.notes].join("\n")}\n`;
    }
}
