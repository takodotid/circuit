// SSH sessions to devices. Adapters choose how to talk to their platform; this holds what they share.
//
// Circuit logs in with a key first, then the password. It offers only the keys the connection user takes (`ssh_keys`), since some
// devices lock an account after a few refused tries: those an SSH agent holds (1Password's, or the system's), then `~/.ssh/id_*`
// whose `.pub` is one of them. The password is revealed only when no key logged in.

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Duplex } from "node:stream";
import {
    AgentProtocol,
    type AnyAuthMethod,
    BaseAgent,
    Client,
    type ClientChannel,
    createAgent,
    type IdentityCallback,
    type ParsedKey,
    type SignCallback,
    type SigningRequestOptions,
    utils,
} from "ssh2";
import type { Device } from "../model";

export type Login = {
    host: string;
    port?: number;
    user: string;
    /** Reveals the user's password, called only when no key logged in. */
    password: () => string;
    /** The OpenSSH public keys the user takes. A key of the agent or of `~/.ssh/` whose public half is one of these is tried first. */
    keys?: readonly string[];
    /** Host key algorithms to accept, for a device that negotiates one it then signs wrongly. */
    hostKeys?: string[];
};

/** One way to log in, how to say it, and whether it is the agent's. */
type Way = { how: string; method: () => AnyAuthMethod; agent?: true };

/** The device closed the connection while the agent was still to sign, or had refused. */
class AgentTimeout extends Error {}

/**
 * An SSH agent that offers only some of the keys another agent holds. An agent such as 1Password's may ask the person to approve the
 * key first: past `SIGN_TIMEOUT` the key counts as refused, and the password is tried.
 */
class OnlyKeys extends BaseAgent<ParsedKey> {
    static readonly SIGN_TIMEOUT = 15_000;

    constructor(
        private readonly agent: BaseAgent,
        private readonly keys: ParsedKey[]
    ) {
        super();
    }

    getIdentities(callback: IdentityCallback<ParsedKey>): void {
        callback(undefined, this.keys);
    }

    sign(key: ParsedKey, data: Buffer, options: SigningRequestOptions | SignCallback, callback?: SignCallback): void {
        const done = typeof options === "function" ? options : callback;
        let answered = false;
        let cleared: (() => void) | undefined;

        const answer = (error: Error | undefined, signature?: Buffer) => {
            if (answered) return;
            answered = true;
            clearTimeout(waiting);
            clearTimeout(timer);
            cleared?.();
            done?.(error, signature);
        };

        // Said only when the agent takes a moment, as it does while it asks the person.
        const waiting = setTimeout(
            () => (cleared = Ssh.waiting?.(`Waiting for the SSH agent to sign with ${key.comment || key.type}`)),
            1_000
        );
        // The request runs on a connection of its own, closed when it ends or times out, so a question nobody answers keeps nothing open.
        let stream: Duplex | undefined;
        const timer = setTimeout(() => {
            stream?.destroy();
            answer(new Error("the SSH agent did not sign in time"));
        }, OnlyKeys.SIGN_TIMEOUT);

        const signOptions = typeof options === "function" ? {} : options;
        if (!this.agent.getStream)
            return this.agent.sign(key, data, signOptions, (error, signature) => answer(error ?? undefined, signature));

        this.agent.getStream((error, opened) => {
            if (error || !opened) return answer(error ?? new Error("the SSH agent did not answer"));
            stream = opened;

            const protocol = new AgentProtocol(true);
            protocol.on("error", (failed: Error) => answer(failed));
            protocol.pipe(opened).pipe(protocol);
            protocol.sign(key, data, signOptions, (failed, signature) => {
                opened.destroy();
                answer(failed ?? undefined, signature);
            });
        });
    }
}

export class Ssh {
    /** Where Circuit says how it logged in to a device, once per device and way. Set by the command line; silent when absent. */
    static report: ((message: string, refused: boolean) => void) | undefined;

    /** Where Circuit says it waits for the SSH agent, such as while 1Password asks the person. Gives back what takes the line away. */
    static waiting: ((message: string) => () => void) | undefined;

    private static readonly reported = new Set<string>();

    /** The agent declined to sign once in this run, so later logins skip it rather than wait for it again. */
    private static agentDeclined = false;

    /** Where the SSH agent listens: `SSH_AUTH_SOCK`, or on Windows the pipe the system's agent and 1Password's share. */
    static agentPath(): string | undefined {
        return process.env.SSH_AUTH_SOCK || (process.platform === "win32" ? "\\\\.\\pipe\\openssh-ssh-agent" : undefined);
    }

    /** The key itself, the second word of an OpenSSH public key line. */
    static blob(line: string): string {
        return line.trim().split(/\s+/)[1] ?? "";
    }

    /** The agent's keys that are among `wanted`, or none when there is no agent or it doesn't answer within 5 seconds. */
    private static agentKeys(agent: BaseAgent, wanted: ReadonlySet<string>): Promise<ParsedKey[]> {
        return new Promise((resolve) => {
            const timer = setTimeout(() => resolve([]), 5_000);

            agent.getIdentities((error, keys) => {
                clearTimeout(timer);
                if (error || !keys) return resolve([]);

                // An OpenSSH agent, 1Password's too, gives each key parsed.
                const parsed = keys.filter((key): key is ParsedKey => typeof key === "object" && "getPublicSSH" in key);
                resolve(parsed.filter((key) => wanted.has(key.getPublicSSH().toString("base64"))));
            });
        });
    }

    /** The ways to log in, in the order to try them: the agent's keys, the files' keys, then the password. */
    private static async ways(login: Login): Promise<Way[]> {
        const username = login.user;
        const wanted = new Set((login.keys ?? []).map((line) => Ssh.blob(line)).filter(Boolean));
        const ways: Way[] = [];

        const path = Ssh.agentPath();
        if (wanted.size && path && !Ssh.agentDeclined) {
            const agent = createAgent(path);
            const keys = await Ssh.agentKeys(agent, wanted);
            if (keys.length) {
                const names = keys.map((key) => key.comment || key.type).join(", ");
                ways.push({
                    how: `the key ${names} from the SSH agent`,
                    method: () => ({ type: "agent", username, agent: new OnlyKeys(agent, keys) }),
                    agent: true,
                });
            }
        }

        for (const name of ["id_ed25519", "id_ecdsa", "id_rsa"]) {
            const file = join(homedir(), ".ssh", name);
            if (!wanted.size || !existsSync(file) || !existsSync(`${file}.pub`)) continue;
            if (!wanted.has(Ssh.blob(readFileSync(`${file}.pub`, "utf8")))) continue;

            // A key with a passphrase is left to the agent: Circuit has no way to ask for it here.
            const key = utils.parseKey(readFileSync(file));
            if (key instanceof Error) continue;

            ways.push({ how: `~/.ssh/${name}`, method: () => ({ type: "publickey", username, key }) });
        }

        ways.push({ how: "the password", method: () => ({ type: "password", username, password: login.password() }) });
        return ways;
    }

    /** Say how Circuit logged in, when the user takes keys: by which key, or by the password after the keys were refused. */
    private static tell(login: Login, used: Way | undefined, ways: readonly Way[], agentRefused: string): void {
        if (!used || !Ssh.report || !login.keys?.length) return;

        const key = `${login.host}\u0000${used.how}`;
        if (Ssh.reported.has(key)) return;
        Ssh.reported.add(key);

        const offered = ways.filter((way) => way !== used && way.how !== "the password").map((way) => way.how);
        if (used.how !== "the password") Ssh.report(`Logged in to ${login.host} with ${used.how}.`, false);
        else if (agentRefused)
            Ssh.report(
                `Logged in to ${login.host} with the password: the SSH agent would not sign with ${offered.join(" and ")} (${agentRefused}). In 1Password, approve the key when it asks.`,
                true
            );
        else if (offered.length)
            Ssh.report(
                `Logged in to ${login.host} with the password: it refused ${offered.join(" and ")}. It may not have the key yet.`,
                true
            );
        else
            Ssh.report(
                `Logged in to ${login.host} with the password: none of the user's ssh_keys is in an SSH agent or ~/.ssh here.`,
                false
            );
    }

    /** The address SSH reaches a device at. A device without one is reached only through its console. */
    static hostOf(device: Device): string {
        if (!device.connection.host) throw new Error(`${device.name} has no management address; it is reached through its console`);
        return device.connection.host;
    }

    /** Open a session, with the user's keys first, then the password. */
    static async connect(login: Login): Promise<Client> {
        const ways = await Ssh.ways(login);

        try {
            return await Ssh.attempt(login, ways);
        } catch (error) {
            // A device ends a login that waits too long, as while an agent asks the person: once more, without the agent.
            const rest = ways.filter((way) => !way.agent);
            if (!(error instanceof AgentTimeout) || rest.length === ways.length) throw error;
            return Ssh.attempt(login, rest, error.message);
        }
    }

    /** One connection, trying `ways` in order. */
    private static attempt(login: Login, ways: readonly Way[], agentRefused = ""): Promise<Client> {
        return new Promise((resolve, reject) => {
            const client = new Client();
            let used: Way | undefined;
            let next = 0;
            let ready = false;

            client
                .on("ready", () => {
                    ready = true;
                    Ssh.tell(login, used, ways, agentRefused);
                    resolve(client);
                })
                // An agent that won't sign, such as 1Password when the person declines, refuses that key only: ssh2 goes on to the next way.
                .on("error", (error: Error & { level?: string }) => {
                    if (error.level !== "agent") return reject(error);
                    agentRefused = error.message;
                    Ssh.agentDeclined = true;
                })
                .on("close", () => {
                    if (ready) return;
                    if (agentRefused) reject(new AgentTimeout(agentRefused));
                    else reject(new Error(`${login.host} closed the connection before Circuit logged in`));
                })
                .connect({
                    host: login.host,
                    port: login.port ?? 22,
                    username: login.user,
                    readyTimeout: 60_000,
                    ...(login.hostKeys ? { algorithms: { serverHostKey: login.hostKeys as never } } : {}),
                    authHandler: (_left, _partial, done) => {
                        used = ways[next++];
                        // `false` ends the tries, which ssh2 takes though its types leave it out.
                        done(used ? used.method() : (false as never));
                    },
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

            // The give-up timer is cleared once done, or a long one, such as a commit's, keeps Circuit from ending for its whole length.
            const finish = () => {
                if (finished) return;

                finished = true;
                clearTimeout(giveUp);
                channel.removeListener("data", onData);
                resolve(output);
            };

            const onData = (chunk: Buffer) => {
                output += chunk.toString("utf8");
                if (done(output)) setTimeout(finish, settle);
            };

            channel.on("data", onData);
            const giveUp = setTimeout(finish, timeout);
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
