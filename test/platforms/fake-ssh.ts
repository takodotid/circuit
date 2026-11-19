// A fake device over SSH. It takes one password, for one user or each of a list, such as a user with and without RouterOS's flags. `answer` answers each exec command and each line typed into the shell, and `commands` keeps them. SFTP reads `files`.

import { generateKeyPairSync } from "node:crypto";
import type { AddressInfo } from "node:net";
import { Server, utils } from "ssh2";
import type { SFTPWrapper } from "ssh2";

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
    /** The lines typed into a shell, which `commands` holds too. */
    readonly shellLines: string[] = [];
    /** What SFTP reads, by path. */
    readonly files = new Map<string, Buffer>();
    private readonly server: Server;

    constructor(
        private readonly user: string | readonly string[],
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

                    session.on("sftp", (acceptSftp) => this.serveFiles(acceptSftp()));
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

    /** Reads of `files`, as a device's SFTP server answers them. Each handle is a file's place among those opened. */
    private serveFiles(sftp: SFTPWrapper): void {
        const { STATUS_CODE } = utils.sftp;
        const opened: Buffer[] = [];
        const contentOf = (handle: Buffer) => opened[handle.readUInt32BE(0)];

        sftp.on("OPEN", (request, path) => {
            const content = this.files.get(path);
            if (!content) return sftp.status(request, STATUS_CODE.NO_SUCH_FILE);

            const handle = Buffer.alloc(4);
            handle.writeUInt32BE(opened.push(content) - 1);
            sftp.handle(request, handle);
        });
        sftp.on("FSTAT", (request, handle) => {
            const size = contentOf(handle)?.length ?? 0;
            sftp.attrs(request, { mode: 0o644, uid: 0, gid: 0, size, atime: 0, mtime: 0 });
        });
        sftp.on("READ", (request, handle, offset, length) => {
            const content = contentOf(handle) ?? Buffer.alloc(0);
            if (offset >= content.length) return sftp.status(request, STATUS_CODE.EOF);
            sftp.data(request, content.subarray(offset, offset + length));
        });
        sftp.on("CLOSE", (request) => sftp.status(request, STATUS_CODE.OK));
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
