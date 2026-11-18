// Without a terminal, such as in a script, nothing spins and nothing is asked.

import * as prompts from "@clack/prompts";
import { styleText } from "node:util";

export type Choice<T> = { value: T; label: string; hint?: string; disabled?: boolean };

export class Ui {
    /** 128 + SIGINT, as a shell reports a program stopped with Ctrl-C. */
    static readonly INTERRUPTED_EXIT_CODE = 130;

    private static readonly SECOND_MS = 1000;
    private static readonly SPINNER_FRAME_MS = 100;

    /** How long `wait` waits before its spinner shows. */
    private static readonly WAIT_DELAY_MS = 150;

    /** The width when the terminal doesn't say. */
    private static readonly DEFAULT_COLUMNS = 80;

    /** What the spinner's frame and its seconds take beside the message, and the least room left for the message. */
    private static readonly SPINNER_CHARS = 12;
    private static readonly MIN_MESSAGE_CHARS = 20;

    /** The borders and padding of each table column. */
    private static readonly CELL_BORDER_CHARS = 3;
    private static readonly MIN_LAST_COLUMN_CHARS = 12;

    /** The narrowest terminal the logotype fits in. */
    private static readonly LOGO_COLUMNS = 64;

    // oxlint-disable-next-line typescript/no-unnecessary-type-conversion -- off a terminal, isTTY is undefined, not false
    static readonly interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);

    /** Color only for a terminal, and never when NO_COLOR is set. */
    private static paint(format: Parameters<typeof styleText>[0], text: string, stream: NodeJS.WriteStream = process.stdout): string {
        return stream.isTTY && !process.env.NO_COLOR ? styleText(format, text) : text;
    }

    static bold(text: string): string {
        return Ui.paint("bold", text);
    }

    static dim(text: string): string {
        return Ui.paint("dim", text);
    }

    static red(text: string, stream?: NodeJS.WriteStream): string {
        return Ui.paint("red", text, stream);
    }

    static green(text: string): string {
        return Ui.paint("green", text);
    }

    static yellow(text: string, stream?: NodeJS.WriteStream): string {
        return Ui.paint("yellow", text, stream);
    }

    private static magenta(text: string): string {
        return Ui.paint("magenta", text);
    }

    static fail(message: string): never {
        Ui.active?.halt();
        console.error(Ui.red(message, process.stderr));
        process.exit(1);
    }

    static warn(message: string): void {
        console.error(`${Ui.yellow("  warn ", process.stderr)}  ${message}`);
    }

    static error(message: string): void {
        console.error(`${Ui.red("  error", process.stderr)}  ${message}`);
    }

    static done(message: string): void {
        console.log(`${Ui.green("✔")} ${message}`);
    }

    /** The filter every printer passes text through, and the mark on a printer that already does. */
    private static filter: (text: string) => string = (text) => text;
    private static readonly FILTERED = Symbol("filtered");

    /**
     * From now on, every text Circuit prints passes through `filter` first, from wherever it is printed. Call it before a spinner starts, which puts back the printers it found. Bytes pass as they are, such as a console's live stream: a chunk can end in the middle of what the filter looks for. A printer replaced since is wrapped on the next call.
     */
    static filterOutput(filter: (text: string) => string): void {
        Ui.filter = filter;
        const filtered = (printer: object) => Ui.FILTERED in printer;

        for (const stream of [process.stdout, process.stderr]) {
            if (filtered(stream.write)) continue;
            const write = stream.write.bind(stream) as (chunk: unknown, ...rest: unknown[]) => boolean;
            stream.write = Object.assign(
                (chunk: unknown, ...rest: unknown[]) => write(typeof chunk === "string" ? Ui.filter(chunk) : chunk, ...rest),
                { [Ui.FILTERED]: true }
            ) as typeof stream.write;
        }

        // Bun's console writes to the terminal itself, not through the streams above.
        for (const name of ["log", "info", "warn", "error", "debug"] as const) {
            const print = console[name];
            if (filtered(print)) continue;
            console[name] = Object.assign(
                (...args: unknown[]) => print(...args.map((arg) => (typeof arg === "string" ? Ui.filter(arg) : arg))),
                { [Ui.FILTERED]: true }
            );
        }
    }

    /** The spinner on screen now: drawn again after a line printed above it, and halted when Circuit stops. */
    private static active: { draw: () => void; halt: () => void } | undefined;

    /**
     * Runs `work` behind a spinner with the seconds it has taken. Lines printed meanwhile, such as a platform's progress, go above it. When done it leaves a line: ◇ when it worked, ■ when it failed.
     */
    static step<T>(message: string, work: () => Promise<T>): Promise<T> {
        return Ui.spin(message, work, { leave: true, delay: 0 });
    }

    /**
     * A spinner that leaves nothing behind, for a short wait such as the check before each command. It shows only after a moment, so a quick answer, such as one from the cache, shows nothing.
     */
    static wait<T>(message: string, work: () => Promise<T>): Promise<T> {
        return Ui.spin(message, work, { leave: false, delay: Ui.WAIT_DELAY_MS });
    }

    private static async spin<T>(message: string, work: () => Promise<T>, options: { leave: boolean; delay: number }): Promise<T> {
        // In a script nothing spins; inside another spinner, that one keeps going.
        if (!Ui.interactive || Ui.active) return work();

        // One line only: a longer one would wrap, and could not be drawn over.
        const width = Math.max(Ui.MIN_MESSAGE_CHARS, (process.stdout.columns ?? Ui.DEFAULT_COLUMNS) - Ui.SPINNER_CHARS);
        const text = message.length > width ? `${message.slice(0, width - 1)}…` : message;
        const frames = ["◒", "◐", "◓", "◑"];
        const started = Date.now();
        let frame = 0;
        let shown = false;

        const seconds = () => {
            const taken = Math.floor((Date.now() - started) / Ui.SECOND_MS);
            return taken >= 1 ? Ui.dim(` [${taken}s]`) : "";
        };
        const draw = () => {
            shown = true;
            process.stdout.write(`\r${Ui.magenta(frames[frame++ % frames.length]!)}  ${text}${seconds()}\x1b[K`);
        };
        const clear = () => {
            if (shown) process.stdout.write("\r\x1b[K");
        };

        const printers = { log: console.log, info: console.info, warn: console.warn, error: console.error };
        for (const name of Object.keys(printers) as (keyof typeof printers)[])
            console[name] = (...args: unknown[]) => {
                clear();
                printers[name](...args);
                if (shown) draw();
            };

        let ticker: ReturnType<typeof setInterval> | undefined;
        const start = setTimeout(() => {
            draw();
            ticker = setInterval(draw, Ui.SPINNER_FRAME_MS);
        }, options.delay);

        const halt = () => {
            clearTimeout(start);
            clearInterval(ticker);
            Object.assign(console, printers);
            clear();
            Ui.active = undefined;
        };
        Ui.active = { draw: () => shown && draw(), halt };

        try {
            const result = await work();
            const taken = seconds();
            halt();
            if (options.leave) console.log(`${Ui.green("◇")}  ${text}${taken}`);
            return result;
        } catch (error) {
            const taken = seconds();
            halt();
            if (options.leave) console.log(`${Ui.red("■")}  ${text}${taken}`);
            throw error;
        }
    }

    /**
     * Say what Circuit waits for while it can't spin, such as while 1Password asks the person to unlock it. Gives back what takes the line away again, and brings back the spinner it covered.
     */
    static blocked(message: string): () => void {
        if (!Ui.interactive) return () => {};

        process.stdout.write(`\r${Ui.magenta("◒")}  ${message}\x1b[K`);
        return () => {
            process.stdout.write("\r\x1b[K");
            Ui.active?.draw();
        };
    }

    /** Stop when the person pressed Ctrl-C or Esc on a question. */
    private static answered<T>(value: T): Exclude<T, symbol> {
        if (prompts.isCancel(value)) {
            prompts.cancel("Stopped. Nothing changed.");
            process.exit(Ui.INTERRUPTED_EXIT_CODE);
        }

        return value as Exclude<T, symbol>;
    }

    /** The default is no, so a stray Enter changes nothing. */
    static async confirm(message: string, initial = false): Promise<boolean> {
        return Ui.answered(await prompts.confirm({ message, initialValue: initial }));
    }

    static async select<T>(message: string, choices: readonly Choice<T>[], initial?: T): Promise<T> {
        const options = choices.map((choice) => ({ ...choice })) as prompts.Option<T>[];
        return Ui.answered(await prompts.select<T>({ message, options, ...(initial !== undefined ? { initialValue: initial } : {}) }));
    }

    static async text(
        message: string,
        options: { initial?: string; placeholder?: string; check?: (value: string) => string | undefined } = {}
    ): Promise<string> {
        return Ui.answered(
            await prompts.text({
                message,
                ...(options.initial !== undefined ? { initialValue: options.initial } : {}),
                ...(options.placeholder !== undefined ? { placeholder: options.placeholder } : {}),
                ...(options.check ? { validate: (value) => options.check!(value ?? "") } : {}),
            })
        );
    }

    /** A value typed without showing it, such as a password. With `empty`, Enter alone gives "". */
    static async secret(message: string, options: { empty?: boolean } = {}): Promise<string> {
        const answer = await prompts.password({ message, validate: (value) => (value || options.empty ? undefined : "Type a value.") });
        return Ui.answered(answer) ?? "";
    }

    /** Colors take no room on screen. */
    private static width(text: string): number {
        return text.replace(/\x1b\[[0-9;]*m/g, "").length;
    }

    /** Words of `text` in lines of at most `width` characters; a longer word is cut. Colors are dropped, as a cut could break one. */
    private static wrap(text: string, width: number): string[] {
        const plain = text.replace(/\x1b\[[0-9;]*m/g, "");
        if (plain.length <= width) return [text];

        const lines: string[] = [];
        let line = "";
        for (const word of plain.split(" ")) {
            const next = line ? `${line} ${word}` : word;
            if (next.length <= width) {
                line = next;
                continue;
            }
            if (line) lines.push(line);
            let rest = word;
            while (rest.length > width) {
                lines.push(rest.slice(0, width));
                rest = rest.slice(width);
            }
            line = rest;
        }
        if (line) lines.push(line);
        return lines;
    }

    /**
     * A column with `right` lines up its numbers on the right. In a terminal too narrow for the table, the last column's text goes on more lines.
     */
    static table(columns: readonly { title: string; right?: boolean }[], rows: readonly (readonly string[])[]): string {
        const widths = columns.map((column, at) => Math.max(column.title.length, ...rows.map((row) => Ui.width(row[at] ?? ""))));

        // The last border takes 1 more character.
        const room = (process.stdout.isTTY ? (process.stdout.columns ?? 0) : 0) - 1 - Ui.CELL_BORDER_CHARS * columns.length;
        const others = widths.slice(0, -1).reduce((sum, width) => sum + width, 0);
        if (room > 0 && others + widths.at(-1)! > room)
            widths[widths.length - 1] = Math.max(columns.at(-1)!.title.length, room - others, Ui.MIN_LAST_COLUMN_CHARS);

        const line = (left: string, middle: string, right: string) =>
            Ui.dim(`${left}${widths.map((width) => "─".repeat(width + 2)).join(middle)}${right}`);
        const bar = Ui.dim("│");
        const cell = (text: string, at: number) => {
            const pad = " ".repeat(Math.max(0, widths[at]! - Ui.width(text)));
            return columns[at]!.right ? `${pad}${text}` : `${text}${pad}`;
        };
        const row = (cells: readonly string[]) => {
            const wrapped = cells.map((text, at) => (at === columns.length - 1 ? Ui.wrap(text, widths[at]!) : [text]));
            const height = Math.max(...wrapped.map((lines) => lines.length));
            return Array.from(
                { length: height },
                (_, index) => `${bar} ${wrapped.map((lines, at) => cell(lines[index] ?? "", at)).join(` ${bar} `)} ${bar}`
            );
        };

        return [
            line("┌", "┬", "┐"),
            ...row(columns.map((column) => Ui.bold(column.title))),
            line("├", "┼", "┤"),
            ...rows.flatMap((cells) => row(columns.map((_, at) => cells[at] ?? ""))),
            line("└", "┴", "┘"),
        ].join("\n");
    }

    /** In the font of the logotype on the site, drawn with blocks. */
    static readonly LOGO = [
        " ▄██████▄   ██  ███████▄    ▄██████▄   ██     ██  ██  ████████",
        "███    ███  ██  ██    ███  ███    ███  ██     ██  ██     ██",
        "██          ██  ███████▀   ██          ██     ██  ██     ██",
        "███    ███  ██  ██   ██▄   ███    ███  ███   ███  ██     ██",
        " ▀██████▀   ██  ██    ██▄   ▀██████▀    ▀█████▀   ██     ██",
    ];

    /** The logotype and a line under it, in a terminal wide enough; elsewhere, the line alone. */
    static logo(line: string): void {
        if (!Ui.interactive) return;
        if ((process.stdout.columns ?? 0) < Ui.LOGO_COLUMNS) {
            console.log(Ui.bold(line));
            return;
        }
        console.log(`\n${Ui.LOGO.map((row) => `  ${Ui.bold(row)}`).join("\n")}\n\n  ${Ui.dim(line)}\n`);
    }

    /** A heading for a run of questions, and the line that closes it. */
    static intro(title: string): void {
        if (Ui.interactive) prompts.intro(Ui.bold(title));
    }

    static outro(message: string): void {
        if (Ui.interactive) prompts.outro(message);
        else console.log(message);
    }

    static note(message: string, title?: string): void {
        if (Ui.interactive) prompts.note(message, title);
        else console.log(title ? `${title}\n${message}` : message);
    }
}
