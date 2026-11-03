// How the command line talks to a person: a spinner while it waits, questions with a safe default, and messages in colour. Without a terminal, such as in a script, nothing spins and nothing is asked.

import * as prompts from "@clack/prompts";
import { styleText } from "node:util";

/** One choice in a list: what it gives back, what it says, a hint beside it, and whether it can be picked. */
export type Choice<T> = { value: T; label: string; hint?: string; disabled?: boolean };

export class Ui {
    /** A person is at a terminal: Circuit may spin and ask. */
    static readonly interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);

    /** Colour only for a terminal, and never when NO_COLOR is set. */
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

    /** Print why Circuit stops, and stop. */
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

    /** The spinner on screen now: drawn again after a line printed above it, and halted when Circuit stops. */
    private static active: { draw: () => void; halt: () => void } | undefined;

    /**
     * Run `work` behind a spinner that says what Circuit waits for, with the seconds it has taken. Lines printed meanwhile, such as a
     * platform's progress, go above it. When done it leaves a line, ◇ when it worked or ■ when it failed.
     */
    static step<T>(message: string, work: () => Promise<T>): Promise<T> {
        return Ui.spin(message, work, { leave: true, delay: 0 });
    }

    /**
     * Wait for `work` with a spinner that leaves nothing behind, for a short wait such as the check before each command. It shows only
     * after a moment, so a quick answer, such as one from the cache, shows nothing.
     */
    static wait<T>(message: string, work: () => Promise<T>): Promise<T> {
        return Ui.spin(message, work, { leave: false, delay: 150 });
    }

    private static async spin<T>(message: string, work: () => Promise<T>, options: { leave: boolean; delay: number }): Promise<T> {
        // In a script nothing spins; inside another spinner, that one keeps going.
        if (!Ui.interactive || Ui.active) return work();

        // One line only: a longer one would wrap, and could not be drawn over.
        const width = Math.max(20, (process.stdout.columns ?? 80) - 12);
        const text = message.length > width ? `${message.slice(0, width - 1)}…` : message;
        const frames = ["◒", "◐", "◓", "◑"];
        const started = Date.now();
        let frame = 0;
        let shown = false;

        const seconds = () => {
            const taken = Math.floor((Date.now() - started) / 1000);
            return taken >= 1 ? Ui.dim(` [${taken}s]`) : "";
        };
        const draw = () => {
            shown = true;
            process.stdout.write(`\r${Ui.magenta(frames[frame++ % frames.length]!)}  ${text}${seconds()}\x1b[K`);
        };
        const clear = () => {
            if (shown) process.stdout.write("\r\x1b[K");
        };

        // A line printed while the spinner is on goes above it, and the spinner is drawn again under it.
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
            ticker = setInterval(draw, 100);
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
     * Say what Circuit waits for while it can't spin, such as while 1Password asks the person to unlock it. Gives back what takes the
     * line away again, and brings back the spinner it covered.
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
            prompts.cancel("Stopped, nothing changed.");
            process.exit(130);
        }

        return value as Exclude<T, symbol>;
    }

    /** A yes or no question. The default is no, so a stray Enter changes nothing. */
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

    /** The CIRCUIT logotype, in the font of the one on the site, drawn with blocks. */
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
        if ((process.stdout.columns ?? 0) < 64) {
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

    /** A boxed note, such as the next steps. */
    static note(message: string, title?: string): void {
        if (Ui.interactive) prompts.note(message, title);
        else console.log(title ? `${title}\n${message}` : message);
    }
}
