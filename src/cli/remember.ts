// Remembering secrets between commands, only when the person opts in: values read from 1Password and passwords typed for a secrets file, kept for 10 or 30 minutes so the next commands don't ask again. A small Circuit process keeps them in its memory, never in a file, and stops when the time is up, when the computer restarts, or with `circuit secrets forget`. It is like ssh-agent: it answers only a program that shows the token in `~/.circuit/secrets-agent.json`, a file only its owner can read.

import { spawn } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { connect, createServer } from "node:net";
import { join, resolve } from "node:path";
import { OnePassword, SecretsFile } from "../core/secrets-file";
import { Releases } from "./releases";
import { Ui } from "./ui";

/** What the process keeps: values by their 1Password reference, and typed passwords by the secrets file's full path. */
type Held = { values: Record<string, string>; passwords: Record<string, string> };
type Request = { op: "get" | "put" | "stop"; values?: Record<string, string>; passwords?: Record<string, string>; until?: number };
type Answer = { ok: true; until: number } & Partial<Held>;
/** Where the process listens, the token it asks for, and when it stops. */
type Info = { endpoint: string; token: string; until: number };

/** The small process that keeps remembered secrets in memory, and how a command talks to it. */
export class SecretsAgent {
    /** The hidden command that starts the process. */
    static readonly COMMAND = "__secrets-agent";
    /** The longest Circuit remembers, in minutes. */
    static readonly LONGEST = 30;
    /** The largest request the process reads, so a stray program can't fill its memory. */
    private static readonly LARGEST = 1024 * 1024;
    /** What the process keeps of the environment it starts with: enough to run, and no secret given in a variable. */
    private static readonly ENVIRONMENT = [
        "PATH",
        "Path",
        "SystemRoot",
        "SYSTEMROOT",
        "windir",
        "TEMP",
        "TMP",
        "HOME",
        "USERPROFILE",
        "CIRCUIT_HOME",
    ];

    static infoPath(): string {
        return join(Releases.home(), "secrets-agent.json");
    }

    private static info(): Info | undefined {
        try {
            const info = JSON.parse(readFileSync(SecretsAgent.infoPath(), "utf8")) as Info;
            return info.until > Date.now() ? info : undefined;
        } catch {
            return undefined;
        }
    }

    /** Ask the running process. Undefined when none is running, or it does not answer within two seconds. */
    static ask(request: Request): Promise<Answer | undefined> {
        const info = SecretsAgent.info();
        if (!info) return Promise.resolve(undefined);

        return new Promise((done) => {
            let answer = "";
            const socket = connect(info.endpoint);
            const finish = (value?: Answer) => {
                clearTimeout(timer);
                socket.destroy();
                done(value);
            };
            const timer = setTimeout(() => finish(), 2000);

            socket.on("connect", () => socket.write(`${JSON.stringify({ ...request, token: info.token })}\n`));
            socket.on("data", (chunk) => {
                answer += chunk.toString("utf8");
                const end = answer.indexOf("\n");
                if (end < 0) return;
                try {
                    const parsed = JSON.parse(answer.slice(0, end)) as Answer;
                    finish(parsed.ok ? parsed : undefined);
                } catch {
                    finish();
                }
            });
            socket.on("error", () => finish());
            socket.on("close", () => finish());
        });
    }

    /** How this Circuit runs itself: the installed binary, or Bun with these sources. */
    private static self(): string[] {
        return Releases.binary() ? [process.execPath] : [process.execPath, join(import.meta.dir, "index.ts")];
    }

    /** Start the process, to stop at `until`. False when it did not answer. */
    static async start(until: number): Promise<boolean> {
        const home = Releases.home();
        mkdirSync(home, { recursive: true });

        const id = randomBytes(8).toString("hex");
        const config = {
            endpoint: process.platform === "win32" ? `\\\\.\\pipe\\circuit-secrets-${id}` : join(home, `secrets-${id}.sock`),
            token: randomBytes(32).toString("base64url"),
            until: SecretsAgent.limit(until),
        };

        const environment = Object.fromEntries(
            SecretsAgent.ENVIRONMENT.filter((name) => process.env[name] !== undefined).map((name) => [name, process.env[name]!])
        );
        const [command, ...args] = SecretsAgent.self();
        const child = spawn(command!, [...args, SecretsAgent.COMMAND], {
            detached: true,
            windowsHide: true,
            stdio: ["pipe", "ignore", "ignore"],
            env: environment,
        });
        child.on("error", () => {});
        // The token goes through stdin, never the command line or the environment, which other programs can see.
        child.stdin!.end(JSON.stringify(config));
        child.unref();

        for (let tries = 0; tries < 50; tries++) {
            await new Promise((wait) => setTimeout(wait, 100));
            if (await SecretsAgent.ask({ op: "get" })) return true;
        }
        return false;
    }

    /** No later than LONGEST minutes from now. */
    private static limit(until: number): number {
        return Math.min(until, Date.now() + SecretsAgent.LONGEST * 60_000);
    }

    private static same(given: unknown, token: string): boolean {
        if (typeof given !== "string") return false;
        const a = Buffer.from(given);
        const b = Buffer.from(token);
        return a.length === b.length && timingSafeEqual(a, b);
    }

    /** The process itself: listen until the time is up or someone says stop, answering only those with the token. */
    static async serve(): Promise<void> {
        let text = "";
        for await (const chunk of process.stdin) text += chunk;
        const { endpoint, token, until } = JSON.parse(text) as Info;

        const held: Held = { values: {}, passwords: {} };
        let deadline = SecretsAgent.limit(until);
        let timer: ReturnType<typeof setTimeout> | undefined;

        const write = () =>
            writeFileSync(SecretsAgent.infoPath(), JSON.stringify({ endpoint, token, until: deadline } satisfies Info), { mode: 0o600 });
        // Remove the file only while it is still this process's, not a newer one's.
        const unlist = () => {
            try {
                if ((JSON.parse(readFileSync(SecretsAgent.infoPath(), "utf8")) as Info).token === token) rmSync(SecretsAgent.infoPath());
            } catch {}
        };
        const stop = () => {
            server.close();
            unlist();
            if (process.platform !== "win32") rmSync(endpoint, { force: true });
            process.exit(0);
        };
        const schedule = () => {
            clearTimeout(timer);
            timer = setTimeout(stop, Math.max(0, deadline - Date.now()));
        };

        const server = createServer((socket) => {
            let request = "";
            socket.on("error", () => socket.destroy());
            socket.on("data", (chunk) => {
                request += chunk.toString("utf8");
                if (request.length > SecretsAgent.LARGEST) return socket.destroy();

                const end = request.indexOf("\n");
                if (end < 0) return;

                let asked: Request & { token?: unknown };
                try {
                    asked = JSON.parse(request.slice(0, end));
                } catch {
                    return socket.destroy();
                }
                if (!SecretsAgent.same(asked.token, token)) return socket.destroy();

                if (asked.op === "stop") {
                    unlist();
                    socket.end(`${JSON.stringify({ ok: true, until: Date.now() })}\n`, stop);
                    return;
                }
                if (asked.op === "put") {
                    Object.assign(held.values, asked.values ?? {});
                    Object.assign(held.passwords, asked.passwords ?? {});
                    if (typeof asked.until === "number") {
                        deadline = SecretsAgent.limit(asked.until);
                        write();
                        schedule();
                    }
                }
                socket.end(`${JSON.stringify({ ok: true, until: deadline, ...held } satisfies Answer)}\n`);
            });
        });

        if (process.platform !== "win32") rmSync(endpoint, { force: true });
        server.listen(endpoint, () => {
            if (process.platform !== "win32") chmodSync(endpoint, 0o600);
            write();
            schedule();
        });
        server.on("error", () => process.exit(1));
        await new Promise(() => {});
    }
}

/** When a command remembers what it read, asks to, or says it used what was remembered. */
export class Remember {
    /** Passwords typed in this run, by the secrets file's full path. */
    private static readonly typed = new Map<string, string>();
    /** When the process stops, while one runs. */
    private static until: number | undefined;
    private static asked = false;
    private static told = false;

    private static settingsPath(): string {
        return join(Releases.home(), "settings.json");
    }

    private static settings(): { askToRemember?: boolean } {
        try {
            return JSON.parse(readFileSync(Remember.settingsPath(), "utf8"));
        } catch {
            return {};
        }
    }

    private static setAsk(ask: boolean): void {
        mkdirSync(Releases.home(), { recursive: true });
        const { askToRemember: _, ...rest } = Remember.settings();
        const settings = ask ? rest : { ...rest, askToRemember: false };
        writeFileSync(Remember.settingsPath(), `${JSON.stringify(settings, null, 4)}\n`);
    }

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

    private static time(until: number): string {
        return new Date(until).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
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
     * After a command read secrets: keep the new ones when Circuit remembers, or, the first time in a run, ask the person whether it
     * should. In a script nothing is asked.
     */
    static async offer(): Promise<void> {
        const values = OnePassword.unheld();
        const passwords = Object.fromEntries([...Remember.typed].filter(([path, password]) => !SecretsFile.holds(path, password)));
        const count = { values: Object.keys(values).length, passwords: Object.keys(passwords).length };

        if (count.values + count.passwords > 0) {
            if (Remember.until === undefined) {
                if (!Ui.interactive || Remember.asked || Remember.settings().askToRemember === false) return;
                Remember.asked = true;

                const minutes = await Remember.choose(Remember.warning(Remember.what(count.values, count.passwords)), true);
                if (minutes === "never") {
                    Remember.setAsk(false);
                    Ui.done("Circuit won't ask again. Turn it on any time: circuit secrets remember");
                    return;
                }
                if (!minutes) return;
                if (!(await Remember.turnOn(minutes))) return;
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

    /** How long to remember: 10 or 30 minutes, nothing, or, when `never` is offered, nothing and never ask again. */
    private static async choose(warning: string, offerNever: boolean): Promise<number | "never" | undefined> {
        Ui.note(warning, "Remember secrets?");
        const choices = [
            { value: 0, label: "No" },
            { value: 10, label: "For 10 minutes" },
            { value: 30, label: "For 30 minutes" },
            ...(offerNever ? [{ value: -1, label: "No, and don't ask again", hint: "circuit secrets remember turns it on" }] : []),
        ];
        const minutes = await Ui.select("Remember them?", choices, 0);
        return minutes === -1 ? "never" : minutes || undefined;
    }

    /** Start remembering for `minutes`, or move the time when Circuit already remembers. */
    private static async turnOn(minutes: number): Promise<boolean> {
        const until = Date.now() + minutes * 60_000;
        const moved = await SecretsAgent.ask({ op: "put", until });
        if (!moved && !(await SecretsAgent.start(until))) {
            Ui.warn("Circuit could not start the process that remembers secrets, so nothing is remembered.");
            return false;
        }

        Remember.until = moved?.until ?? until;
        Ui.done(`Circuit remembers until ${Remember.time(Remember.until)}. Forget now: circuit secrets forget`);
        return true;
    }

    /** `circuit secrets remember`: keep what commands read from now on, for 10 or 30 minutes. */
    static async remember(minutes: number | undefined): Promise<void> {
        if (minutes !== undefined && minutes !== 10 && minutes !== 30) Ui.fail("Give 10 or 30 minutes.");

        Remember.setAsk(true);
        const what = "the values it reads from 1Password and the passwords you type, from now on";
        if (minutes === undefined) {
            if (!Ui.interactive) Ui.fail("Give the minutes: circuit secrets remember 10, or circuit secrets remember 30.");
            const chosen = await Remember.choose(Remember.warning(what), false);
            if (typeof chosen !== "number") return Ui.outro("Nothing is remembered.");
            minutes = chosen;
        } else Ui.note(Remember.warning(what), "Remember secrets");

        await Remember.turnOn(minutes);
    }

    /** `circuit secrets forget`: stop the process, and with it everything it kept. */
    static async forget(): Promise<void> {
        const stopped = await SecretsAgent.ask({ op: "stop" });
        rmSync(SecretsAgent.infoPath(), { force: true });
        Remember.until = undefined;
        Ui.done(stopped ? "Circuit forgot every secret it remembered." : "Circuit remembered no secret.");
    }
}
