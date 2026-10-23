// SSH sessions to devices. Adapters choose how to talk to their platform; this holds what they share.

import { Client, type ClientChannel } from "ssh2";
import type { Device } from "../schema";

export type Login = {
    host: string;
    port?: number;
    user: string;
    password: string;
    /** Host key algorithms to accept, for a device that negotiates one it then signs wrongly. */
    hostKeys?: string[];
};

export class Ssh {
    /** The address SSH reaches a device at. A device without one is reached only through its console. */
    static hostOf(device: Device): string {
        if (!device.connection.host) throw new Error(`${device.name} has no management address; it is reached through its console`);
        return device.connection.host;
    }

    /** Open a session. */
    static connect(login: Login): Promise<Client> {
        return new Promise((resolve, reject) => {
            const client = new Client();

            client
                .on("ready", () => resolve(client))
                .on("error", reject)
                .connect({
                    host: login.host,
                    port: login.port ?? 22,
                    username: login.user,
                    password: login.password,
                    readyTimeout: 30_000,
                    ...(login.hostKeys ? { algorithms: { serverHostKey: login.hostKeys as never } } : {}),
                });
        });
    }

    /** Run one command and return what it printed, stderr included. */
    static exec(client: Client, command: string, timeout = 120_000): Promise<string> {
        return new Promise((resolve, reject) => {
            client.exec(command, (error, stream) => {
                if (error) return reject(error);

                let output = "";
                const append = (chunk: Buffer) => (output += chunk.toString("utf8"));
                const timer = setTimeout(() => resolve(output.trim()), timeout);

                stream.on("data", append);
                stream.stderr.on("data", append);

                stream.on("close", () => {
                    clearTimeout(timer);
                    resolve(output.trim());
                });
            });
        });
    }

    /** An interactive shell, for platforms that take configuration only there. */
    static shell(client: Client, columns = 200, rows = 1000): Promise<ClientChannel> {
        return new Promise((resolve, reject) => {
            client.shell({ cols: columns, rows }, (error, channel) => (error ? reject(error) : resolve(channel)));
        });
    }

    /** Collect output until `done` holds, then wait `settle` for stragglers, or give up at `timeout`. */
    static readUntil(channel: ClientChannel, done: (output: string) => boolean, timeout: number, settle = 400): Promise<string> {
        return new Promise((resolve) => {
            let output = "";
            let finished = false;

            const finish = () => {
                if (finished) return;

                finished = true;
                channel.removeListener("data", onData);
                resolve(output);
            };

            const onData = (chunk: Buffer) => {
                output += chunk.toString("utf8");
                if (done(output)) setTimeout(finish, settle);
            };

            channel.on("data", onData);
            setTimeout(finish, timeout);
        });
    }

    /** Send one line into an interactive shell and collect output until it goes quiet for `settle`. */
    static send(channel: ClientChannel, line: string, timeout = 20_000, settle = 1500): Promise<string> {
        channel.write(line + "\n");

        return new Promise((resolve) => {
            let output = "";
            let timer: ReturnType<typeof setTimeout>;

            const finish = () => {
                channel.removeListener("data", onData);
                resolve(output);
            };

            const onData = (chunk: Buffer) => {
                output += chunk.toString("utf8");
                clearTimeout(timer);
                timer = setTimeout(finish, settle);
            };

            channel.on("data", onData);
            timer = setTimeout(finish, timeout);
        });
    }

    static sleep(milliseconds: number): Promise<unknown> {
        return new Promise((done) => setTimeout(done, milliseconds));
    }

    /** Write a file to the device over SFTP. */
    static upload(client: Client, path: string, content: string | Buffer): Promise<void> {
        return new Promise((resolve, reject) => {
            client.sftp((error, sftp) => {
                if (error) return reject(error);

                sftp.writeFile(path, content, (writeError) => {
                    sftp.end();

                    if (writeError) reject(writeError);
                    else resolve();
                });
            });
        });
    }
}
