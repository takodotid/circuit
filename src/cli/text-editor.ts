// A small text editor in the terminal, for `circuit secrets`: the whole text on one screen, typed into as in any editor. Ctrl+S saves; Esc leaves, or Ctrl+X, or Ctrl+Q where the terminal passes it on (VS Code's keeps Ctrl+Q for itself). It draws on the terminal's alternate screen, so what it showed is gone from the scrollback when it closes, and it never writes the text anywhere but through `save`.

/** One key, as the terminal sends it. */
export type Key =
    | { kind: "text"; text: string }
    | { kind: "up" | "down" | "left" | "right" | "home" | "end" | "page-up" | "page-down" | "enter" | "backspace" | "delete" }
    | { kind: "save" | "quit" };

/** The text being edited, its cursor, and whether it changed since the last save. */
export class EditorBuffer {
    lines: string[];
    row = 0;
    col = 0;
    modified = false;

    constructor(text: string) {
        this.lines = text.replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n");
    }

    text(): string {
        return `${this.lines.join("\n")}\n`;
    }

    private get line(): string {
        return this.lines[this.row]!;
    }

    /** Type text at the cursor. A paste may hold several lines. */
    insert(text: string): void {
        const parts = text.replace(/\r\n?/g, "\n").replace(/\t/g, "    ").split("\n");
        const before = this.line.slice(0, this.col);
        const after = this.line.slice(this.col);

        if (parts.length === 1) {
            this.lines[this.row] = before + parts[0] + after;
            this.col += parts[0]!.length;
        } else {
            const last = parts[parts.length - 1]!;
            this.lines.splice(this.row, 1, before + parts[0], ...parts.slice(1, -1), last + after);
            this.row += parts.length - 1;
            this.col = last.length;
        }
        this.modified = true;
    }

    newline(): void {
        this.insert("\n");
    }

    backspace(): void {
        if (this.col > 0) {
            this.lines[this.row] = this.line.slice(0, this.col - 1) + this.line.slice(this.col);
            this.col--;
        } else if (this.row > 0) {
            const previous = this.lines[this.row - 1]!;
            this.lines.splice(this.row - 1, 2, previous + this.line);
            this.row--;
            this.col = previous.length;
        } else return;
        this.modified = true;
    }

    delete(): void {
        if (this.col < this.line.length) this.lines[this.row] = this.line.slice(0, this.col) + this.line.slice(this.col + 1);
        else if (this.row < this.lines.length - 1) this.lines.splice(this.row, 2, this.line + this.lines[this.row + 1]);
        else return;
        this.modified = true;
    }

    move(kind: "up" | "down" | "left" | "right" | "home" | "end", by = 1): void {
        if (kind === "left") {
            if (this.col > 0) this.col--;
            else if (this.row > 0) this.col = this.lines[--this.row]!.length;
        } else if (kind === "right") {
            if (this.col < this.line.length) this.col++;
            else if (this.row < this.lines.length - 1) {
                this.row++;
                this.col = 0;
            }
        } else if (kind === "up") this.row = Math.max(0, this.row - by);
        else if (kind === "down") this.row = Math.min(this.lines.length - 1, this.row + by);
        else if (kind === "home") this.col = 0;
        else this.col = this.line.length;

        this.col = Math.min(this.col, this.line.length);
    }
}

/** What the editor reads keys from: a terminal in raw mode. */
export type TerminalInput = Pick<NodeJS.ReadStream, "on" | "off" | "resume" | "pause" | "setEncoding"> & {
    setRawMode(mode: boolean): unknown;
};
/** What the editor draws on. */
export type TerminalOutput = Pick<NodeJS.WriteStream, "write" | "on" | "off"> & { rows?: number; columns?: number };

export class TextEditor {
    private static readonly SEQUENCES: Record<string, Key["kind"]> = {
        "\x1b[A": "up",
        "\x1b[B": "down",
        "\x1b[C": "right",
        "\x1b[D": "left",
        "\x1bOA": "up",
        "\x1bOB": "down",
        "\x1bOC": "right",
        "\x1bOD": "left",
        "\x1b[H": "home",
        "\x1b[F": "end",
        "\x1bOH": "home",
        "\x1bOF": "end",
        "\x1b[1~": "home",
        "\x1b[4~": "end",
        "\x1b[5~": "page-up",
        "\x1b[6~": "page-down",
        "\x1b[3~": "delete",
    };

    private static readonly PASTE_START = "\x1b[200~";
    private static readonly PASTE_END = "\x1b[201~";

    /** The keys in what the terminal sent. An escape sequence it doesn't know is dropped. */
    static keys(data: string): Key[] {
        const keys: Key[] = [];
        let text = "";
        const flush = () => {
            if (text) keys.push({ kind: "text", text });
            text = "";
        };

        for (let i = 0; i < data.length;) {
            if (data.startsWith(TextEditor.PASTE_START, i)) {
                flush();
                const end = data.indexOf(TextEditor.PASTE_END, i);
                const pasted = data.slice(i + TextEditor.PASTE_START.length, end < 0 ? data.length : end);
                if (pasted) keys.push({ kind: "text", text: pasted });
                i = end < 0 ? data.length : end + TextEditor.PASTE_END.length;
                continue;
            }

            const char = data[i]!;
            if (char === "\x1b") {
                flush();
                const sequence = /^\x1b(\[[0-9;]*[A-Za-z~]|O[A-Za-z])?/.exec(data.slice(i))![0];
                const kind = TextEditor.SEQUENCES[sequence.replace(/^\x1b\[1;\d+([A-H])$/, "\x1b[$1")];
                if (kind) keys.push({ kind } as Key);
                // Esc alone, nothing after it, is the key itself, not the start of a sequence.
                else if (sequence === "\x1b" && i + 1 === data.length) keys.push({ kind: "quit" });
                i += sequence.length;
                continue;
            }

            const control: Record<string, Key["kind"]> = {
                "\r": "enter",
                "\n": "enter",
                "\x7f": "backspace",
                "\b": "backspace",
                "\x13": "save",
                "\x0f": "save",
                "\x11": "quit",
                "\x18": "quit",
                "\x03": "quit",
            };
            if (control[char]) {
                flush();
                // A terminal may send Enter as \r\n: one Enter.
                if (char === "\r" && data[i + 1] === "\n") i++;
                keys.push({ kind: control[char] } as Key);
            } else if (char === "\t" || char >= " ") text += char;
            i++;
        }

        flush();
        return keys;
    }

    /**
     * Edit `text` on the whole screen until the person leaves. `save` gets the text on Ctrl+S and gives back why it can't be saved, or
     * undefined once saved. `note` shows at the bottom until the first key. Leaving with changes not saved asks to leave a second time.
     */
    static async open(options: {
        title: string;
        text: string;
        note?: string;
        save: (text: string) => string | undefined;
        /** The terminal: the process's own unless a test gives another. */
        terminal?: { input: TerminalInput; output: TerminalOutput };
    }): Promise<void> {
        const stdin = options.terminal?.input ?? (process.stdin as TerminalInput);
        const out = options.terminal?.output ?? (process.stdout as TerminalOutput);
        const buffer = new EditorBuffer(options.text);
        const help = "Ctrl+S save   Esc leave";
        let message = options.note ? `${options.note}   ${help}` : help;
        let top = 0;
        let left = 0;
        let leaving = false;

        const draw = () => {
            const rows = Math.max(3, out.rows ?? 24);
            const cols = Math.max(20, out.columns ?? 80);
            const height = rows - 2;

            if (buffer.row < top) top = buffer.row;
            if (buffer.row >= top + height) top = buffer.row - height + 1;
            if (buffer.col < left) left = buffer.col;
            if (buffer.col >= left + cols) left = buffer.col - cols + 1;

            const title = ` ${options.title}${buffer.modified ? "  (not saved)" : ""}`;
            let screen = `\x1b[?25l\x1b[H\x1b[7m${title.slice(0, cols).padEnd(cols)}\x1b[0m`;
            for (let i = 0; i < height; i++) {
                const line = buffer.lines[top + i];
                screen += `\x1b[${i + 2};1H\x1b[K${line === undefined ? "" : line.slice(left, left + cols)}`;
            }
            screen += `\x1b[${rows};1H\x1b[K\x1b[7m${` ${message}`.slice(0, cols).padEnd(cols)}\x1b[0m`;
            screen += `\x1b[${buffer.row - top + 2};${buffer.col - left + 1}H\x1b[?25h`;
            out.write(screen);
            return height;
        };

        out.write("\x1b[?1049h\x1b[?2004h");
        stdin.setRawMode(true);
        stdin.resume();
        stdin.setEncoding("utf8");

        try {
            await new Promise<void>((done) => {
                let height = draw();
                const redraw = () => (height = draw());
                out.on("resize", redraw);

                const onData = (data: string) => {
                    for (const key of TextEditor.keys(data)) {
                        if (key.kind !== "quit") leaving = false;
                        message = help;

                        if (key.kind === "text") buffer.insert(key.text);
                        else if (key.kind === "enter") buffer.newline();
                        else if (key.kind === "backspace") buffer.backspace();
                        else if (key.kind === "delete") buffer.delete();
                        else if (key.kind === "page-up") buffer.move("up", height);
                        else if (key.kind === "page-down") buffer.move("down", height);
                        else if (key.kind === "save") {
                            const problem = options.save(buffer.text());
                            if (problem) message = `Not saved: ${problem}`;
                            else {
                                buffer.modified = false;
                                message = `Saved. ${help}`;
                            }
                        } else if (key.kind === "quit") {
                            if (!buffer.modified || leaving) {
                                stdin.off("data", onData);
                                out.off("resize", redraw);
                                done();
                                return;
                            }
                            leaving = true;
                            message = "Not saved. Esc again leaves without saving; Ctrl+S saves.";
                        } else buffer.move(key.kind);
                    }
                    redraw();
                };
                stdin.on("data", onData);
            });
        } finally {
            stdin.setRawMode(false);
            stdin.pause();
            out.write("\x1b[?2004l\x1b[?1049l");
        }
    }
}
