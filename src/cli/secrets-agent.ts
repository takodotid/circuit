// The small process that remembers secrets between commands, only when the person opts in: values read from 1Password and passwords typed for a secrets file, kept for 10 minutes, 30 minutes or 24 hours, so the next commands don't ask again. Circuit asks after a command read them. A small Circuit process keeps them in its memory, never in a file, and stops when the time is up, when the computer restarts, or with `circuit secrets forget`. It is like ssh-agent: it answers only a program that shows the token in `~/.circuit/secrets-agent.json`, a file only its owner can read.

import { spawn } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { connect, createServer } from "node:net";
import { join } from "node:path";
import { Installation } from "../core/installation";
import { App } from "./app";

/** What the process keeps: values by their 1Password reference, and typed passwords by the secrets file's full path. */
export type Held = { values: Record<string, string>; passwords: Record<string, string> };
export type Request = { op: "get" | "put" | "stop"; values?: Record<string, string>; passwords?: Record<string, string>; until?: number };
export type Answer = { ok: true; until: number } & Partial<Held>;
/** Where the process listens, the token it asks for, and when it stops. */
export type Info = { endpoint: string; token: string; until: number };

/** The small process that keeps remembered secrets in memory, and how a command talks to it. */
export class SecretsAgent {
    /** The hidden command that starts the process. */
    static readonly COMMAND = "__secrets-agent";
    /** The longest Circuit remembers, in minutes: 24 hours. */
    static readonly LONGEST = 24 * 60;
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
        return join(Installation.home(), "secrets-agent.json");
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

    /** Start the process, to stop at `until`. False when it did not answer. */
    static async start(until: number): Promise<boolean> {
        const home = Installation.home();
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
        const [command, ...args] = App.self();
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
