// Junos `set` statements, collected in the form `show configuration | display set` prints.

/** Collects `set` statements, and comments the plan reads. */
export class JunosStatements {
    private readonly lines: string[] = [];
    private readonly notes: string[] = [];

    set(...words: (string | number)[]): void {
        this.lines.push(`set ${words.join(" ")}`);
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

        return [...unique.filter((line) => !extended.has(line)), ...this.notes].join("\n") + "\n";
    }
}
