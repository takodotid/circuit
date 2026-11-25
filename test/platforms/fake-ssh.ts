// A fake device over SSH. It takes one password, for one user or each of a list, such as a user with and without RouterOS's flags. `answer` answers each exec command and each line typed into the shell, and `commands` keeps them.

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

    /** One RSA host key for every fake device: a port the system gives again in the same run then shows the key known_hosts holds for it. */
    private static readonly HOST_KEY = generateKeyPairSync("rsa", {
        modulusLength: 2048,
        privateKeyEncoding: { type: "pkcs1", format: "pem" },
        publicKeyEncoding: { type: "pkcs1", format: "pem" },
    }).privateKey;

    readonly commands: string[] = [];
    /** The lines typed into a shell, which `commands` holds too. */
    readonly shellLines: string[] = [];
    private readonly server: Server;

    constructor(
        private readonly user: string | readonly string[],
        private readonly answer: (command: string) => string | FakeParts,
        private readonly shell?: FakeShell
    ) {
        this.server = new Server({ hostKeys: [FakeSshDevice.HOST_KEY] }, (client) => {
            client.on("authentication", (context) => {
                const allowed =
                    context.method === "password" &&
                    [this.user].flat().includes(context.username) &&
                    context.password === FakeSshDevice.PASSWORD;

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
                                this.shellLines.push(line);
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

    /** Listen on a free port on 127.0.0.1, and give the port. */
    listen(): Promise<number> {
        return new Promise((done) => this.server.listen(0, "127.0.0.1", () => done((this.server.address() as AddressInfo).port)));
    }

    close(): void {
        this.server.close();
    }
}
