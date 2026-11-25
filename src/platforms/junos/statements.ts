import type { Bfd } from "../../model";

/** Collects `set` statements, and the comments the plan reads. */
export class JunosStatements {
    /** BFD's interval when `routing.bfd` sets none, as the platform has no default: three missed packets 300 ms apart take under a second. Its multiplier is 3. */
    static readonly BFD_INTERVAL_MS = 300;

    /** The units the device prints a rate or a burst in, largest first, while the number left is below `AMOUNT_UNIT_BELOW`. */
    private static readonly AMOUNT_UNITS: readonly (readonly [string, number])[] = [
        ["g", 1e9],
        ["m", 1e6],
        ["k", 1e3],
    ];
    private static readonly AMOUNT_UNIT_BELOW = 1000;

    private readonly lines: string[] = [];
    private readonly notes: string[] = [];

    /** A value as one word: quoted unless it is a plain word. Quoting more than the platform would is harmless, because the comparison ignores quotes. */
    static quote(value: string): string {
        if (/^[\w.:/@-]+$/.test(value)) return value;

        const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
        return `"${escaped}"`;
    }

    /** A rate in bits per second, or a burst in bytes, as the device prints it. A unit is used only when it leaves a whole number below 1000: `250k`, but `1500000000` for 1500m (TRAPS.md). */
    static amount(value: number): string {
        const [unit, scale] = JunosStatements.AMOUNT_UNITS.find(([, each]) => value % each === 0) ?? ["", 1];
        return value / scale < JunosStatements.AMOUNT_UNIT_BELOW ? `${value / scale}${unit}` : String(value);
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
