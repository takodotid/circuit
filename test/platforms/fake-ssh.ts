// A fake device over SSH, for tests of a platform's read and apply. It takes one user with one password. Each exec command, and each line typed into its shell, is answered with what `answer` returns, and kept in `commands`. The shell starts with `banner` and ends each answer with `prompt`.

import { generateKeyPairSync } from "node:crypto";
import type { AddressInfo } from "node:net";
import { Server } from "ssh2";

export type FakeShell = {
    /** What the shell prints when it opens, prompt included. */
    banner: string;
    /** What it prints after each answer. */
    prompt: () => string;
};

/** An answer that arrives in parts, each after a pause, as on a slow or lossy path. */
export type FakeParts = { parts: { text: string; after: number }[] };

export class FakeSshDevice {
    static readonly PASSWORD = "lab-pass";

    readonly commands: string[] = [];
    private readonly server: Server;

    constructor(
        private readonly user: string,
        private readonly answer: (command: string) => string | FakeParts,
        private readonly shell?: FakeShell
    ) {
        const { privateKey } = generateKeyPairSync("rsa", {
            modulusLength: 2048,
            privateKeyEncoding: { type: "pkcs1", format: "pem" },
            publicKeyEncoding: { type: "pkcs1", format: "pem" },
        });

        this.server = new Server({ hostKeys: [privateKey] }, (client) => {
            client.on("authentication", (context) => {
                const allowed =
                    context.method === "password" && context.username === this.user && context.password === FakeSshDevice.PASSWORD;

                if (allowed) context.accept();
                else context.reject(["password"]);
            });

            client.on("ready", () => {
                client.on("session", (accept) => {
                    const session = accept();

                    session.on("exec", (acceptExec, _reject, info) => {
                        const stream = acceptExec();

                        stream.write(FakeSshDevice.whole(this.run(info.command)));
                        stream.exit(0);
                        stream.end();
                    });

                    session.on("pty", (acceptPty) => acceptPty?.());
                    session.on("shell", (acceptShell, reject) => {
                        if (!this.shell) return reject?.();

                        const stream = acceptShell();
                        const shell = this.shell;
                        let typed = "";

                        stream.write(shell.banner);
                        stream.on("data", (chunk: Buffer) => {
                            typed += chunk.toString("utf8");

                            // A terminal sends each line on its own; answer each one whole, with its echo, as a device does.
                            for (let end = typed.search(/\r?\n|\r/); end >= 0; end = typed.search(/\r?\n|\r/)) {
                                const line = typed.slice(0, end);
                                typed = typed.slice(end).replace(/^\r?\n|^\r/, "");
                                const answer = this.run(line);

                                if (typeof answer === "string") {
                                    stream.write(`${line}\r\n${answer}${shell.prompt()}`);
                                    continue;
                                }

                                // Each part waits its pause after the one before; the prompt follows the last.
                                stream.write(`${line}\r\n`);
                                let delay = 0;
                                for (const part of answer.parts) {
                                    delay += part.after;
                                    setTimeout(() => stream.write(part.text), delay);
                                }
                                setTimeout(() => stream.write(shell.prompt()), delay);
                            }
                        });
                    });
                });
            });

            client.on("error", () => {});
        });
    }

    /** An answer in parts, all at once, for an exec. */
    private static whole(answer: string | FakeParts): string {
        return typeof answer === "string" ? answer : answer.parts.map((part) => part.text).join("");
    }

    private run(command: string): string | FakeParts {
        this.commands.push(command);
        return this.answer(command);
    }

    /** Start listening on a free port on 127.0.0.1, and give the port. */
    listen(): Promise<number> {
        return new Promise((done) => this.server.listen(0, "127.0.0.1", () => done((this.server.address() as AddressInfo).port)));
    }

    close(): void {
        this.server.close();
    }
}
