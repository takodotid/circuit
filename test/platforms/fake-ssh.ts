// A fake device over SSH, for tests of a platform's read and apply: it takes one user with one password, and answers each exec command with what `answer` returns, keeping every command it was sent.

import { generateKeyPairSync } from "node:crypto";
import type { AddressInfo } from "node:net";
import { Server } from "ssh2";

export class FakeSshDevice {
    static readonly PASSWORD = "lab-pass";

    readonly commands: string[] = [];
    private readonly server: Server;

    constructor(
        private readonly user: string,
        answer: (command: string) => string
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
                    accept().on("exec", (acceptExec, _reject, info) => {
                        const stream = acceptExec();
                        this.commands.push(info.command);

                        stream.write(answer(info.command));
                        stream.exit(0);
                        stream.end();
                    });
                });
            });

            client.on("error", () => {});
        });
    }

    /** Start listening on a free port on 127.0.0.1, and give the port. */
    listen(): Promise<number> {
        return new Promise((done) => this.server.listen(0, "127.0.0.1", () => done((this.server.address() as AddressInfo).port)));
    }

    close(): void {
        this.server.close();
    }
}
