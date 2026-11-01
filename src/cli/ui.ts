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

    /** Print why Circuit stops, and stop. */
    static fail(message: string): never {
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

    /** Run `work` behind a spinner that says what Circuit waits for. The spinner turns into a tick when it is done, or a cross when it fails. */
    static async step<T>(message: string, work: () => Promise<T>): Promise<T> {
        if (!Ui.interactive) return work();

        const spinner = prompts.spinner({ indicator: "timer" });
        spinner.start(message);

        try {
            const result = await work();
            spinner.stop(message);
            return result;
        } catch (error) {
            spinner.error(message);
            throw error;
        }
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

    /** A value typed without showing it, such as a password. */
    static async secret(message: string): Promise<string> {
        return Ui.answered(await prompts.password({ message, validate: (value) => (value ? undefined : "Type a value.") }));
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
