// Remembering secrets between commands, only after the person says yes. The secrets stay in a small process's memory (src/cli/secrets-agent.ts), never in a file.

import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { OnePassword } from "../core/one-password";
import { SecretsFile } from "../core/secrets-file";
import { Ui } from "./ui";

import { SecretsAgent } from "./secrets-agent";

/** When a command remembers what it read, asks to, or says it used what was remembered. */
export class Remember {
    /** Passwords typed in this run, by the secrets file's full path. */
    private static readonly typed = new Map<string, string>();
    /** When the process stops, while one runs. */
    private static until: number | undefined;
    private static asked = false;
    private static told = false;

    /** A password the person typed for a secrets file, to keep when they choose to. */
    static typedPassword(file: SecretsFile, password: string): void {
        Remember.typed.set(resolve(file.path), password);
    }

    /** At the start of a command: what Circuit remembers, when it does. */
    static async load(): Promise<void> {
        if (!existsSync(SecretsAgent.infoPath())) return;

        const answer = await SecretsAgent.ask({ op: "get" });
        if (!answer) return;

        Remember.until = answer.until;
        OnePassword.hold(answer.values ?? {});
        SecretsFile.hold(answer.passwords ?? {});
    }

    /** The time it stops, and its date when that isn't today. */
    private static time(until: number): string {
        const end = new Date(until);
        const time = end.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        if (end.toDateString() === new Date().toDateString()) return time;

        return `${end.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })} ${time}`;
    }

    /** What would be kept, said for the warning. */
    private static what(values: number, passwords: number): string {
        const parts = [];
        if (values)
            parts.push(
                values === 1 ? "the value Circuit just read from 1Password" : `the ${values} values Circuit just read from 1Password`
            );
        if (passwords) parts.push(passwords === 1 ? "the password you typed" : "the passwords you typed");
        return parts.join(", and ");
    }

    /** What remembering means, before the person says yes. */
    private static warning(what: string): string {
        return [
            `Circuit can keep ${what}, so the next commands don't ask again.`,
            "",
            "While Circuit keeps them:",
            "- any program running as you on this computer can get them, and 1Password does not ask you",
            "- locking 1Password does not make Circuit forget them",
            "",
            "They stay in memory, never in a file, and are gone when the time is up, when the computer restarts, or with circuit secrets forget.",
        ].join("\n");
    }

    /**
     * After a command read secrets: keep the new ones when Circuit remembers, or, the first time in a run, ask the person whether it should. In a script nothing is asked.
     */
    static async offer(): Promise<void> {
        const values = OnePassword.unheld();
        const passwords = Object.fromEntries([...Remember.typed].filter(([path, password]) => !SecretsFile.holds(path, password)));
        const count = { values: Object.keys(values).length, passwords: Object.keys(passwords).length };

        if (count.values + count.passwords > 0) {
            if (Remember.until === undefined) {
                if (!Ui.interactive || Remember.asked) return;
                Remember.asked = true;

                const minutes = await Remember.choose(Remember.warning(Remember.what(count.values, count.passwords)));
                if (!minutes || !(await Remember.turnOn(minutes))) return;
            }

            const answer = await SecretsAgent.ask({ op: "put", values, passwords });
            if (!answer) {
                Remember.until = undefined;
                return;
            }
            OnePassword.hold(values);
            SecretsFile.hold(passwords);
            Remember.until = answer.until;
            return;
        }

        if ((OnePassword.usedHeld || SecretsFile.usedHeld) && Remember.until !== undefined && !Remember.told && Ui.interactive) {
            Remember.told = true;
            console.error(
                Ui.dim(`Used secrets Circuit remembers until ${Remember.time(Remember.until)}. Forget them now: circuit secrets forget`)
            );
        }
    }

    /** How long to remember: 10 minutes, 30 minutes or 24 hours, or undefined for no. */
    private static async choose(warning: string): Promise<number | undefined> {
        Ui.note(warning, "Remember secrets?");
        const minutes = await Ui.select(
            "Remember them?",
            [
                { value: 0, label: "No" },
                { value: 10, label: "For 10 minutes" },
                { value: 30, label: "For 30 minutes" },
                { value: 24 * 60, label: "For 24 hours" },
            ],
            0
        );
        return minutes || undefined;
    }

    /** Start remembering for `minutes`. */
    private static async turnOn(minutes: number): Promise<boolean> {
        const until = Date.now() + minutes * 60_000;
        if (!(await Ui.wait("Starting the process that remembers them", () => SecretsAgent.start(until)))) {
            Ui.warn("Circuit could not start the process that remembers secrets, so nothing is remembered.");
            return false;
        }

        Remember.until = until;
        Ui.done(`Circuit remembers until ${Remember.time(until)}. Forget now: circuit secrets forget`);
        return true;
    }

    /** `circuit secrets forget`: stop the process, and with it everything it kept. */
    static async forget(): Promise<void> {
        const stopped = await SecretsAgent.ask({ op: "stop" });
        rmSync(SecretsAgent.infoPath(), { force: true });
        Remember.until = undefined;
        Ui.done(stopped ? "Circuit forgot every secret it remembered." : "Circuit remembered no secret.");
    }
}
