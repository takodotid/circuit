// A serial console on a jump host or on this computer. A small relay joins the port to a stream, started over SSH on the jump host or here as a child process. The device's CLI then streams through it as through an SSH shell.

import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { Duplex } from "node:stream";
import { Client } from "ssh2";
import type { ClientChannel } from "ssh2";
import { Secrets } from "../core/secrets";
import type { Console, Device, Jump } from "../model";
import { Ssh } from "./ssh";

/** An open console. `close` waits for the console to go quiet, then lets the port go. */
export type ConsoleSession = { channel: ClientChannel; close: () => Promise<void> };

/** How a platform's console asks for a login and shows its prompt, and what moves it on from anywhere else. */
export type ConsoleDialect = {
    login: RegExp;
    password: RegExp;
    /** The CLI's prompt once logged in. */
    prompt: RegExp;
    logout: string;
    /** Other places a console can be left, each with what moves it toward a login prompt: a pager, a config level, a question. Checked before the prompt. */
    others?: readonly (readonly [RegExp, string])[];
    /** The name typed at the login prompt, when the platform adds to it. */
    user?: (user: string) => string;
    /** What the console prints when it refuses a password, for a console that then shows no login prompt. */
    refused?: RegExp;
};

/** The channel a console speaks on: an SSH stream from the relay, or anything shaped like one. */
type Channel = Pick<ClientChannel, "write"> & {
    on(event: "data", listener: (chunk: Buffer) => void): unknown;
    removeListener(event: "data", listener: (chunk: Buffer) => void): unknown;
};

export class SerialConsole {
    private static readonly RELAY_PATH = "/tmp/circuit-console.py";

    /** How long the relay may take to be written and to start. */
    private static readonly RELAY_TIMEOUT_MS = 30_000;
    private static readonly BUSY_RETRY_MS = 5000;
    private static readonly KILL_AFTER_MS = 2000;

    private static readonly SILENCE_MS = 1000;
    private static readonly LOGIN_SILENCE_MS = 800;
    private static readonly SILENCE_LIMIT_MS = 5000;

    private static readonly PASSWORD_TIMEOUT_MS = 60_000;
    private static readonly LOGIN_STEPS = 10;
    private static readonly LOGIN_QUESTIONS = 5;
    private static readonly ERROR_TAIL_CHARS = 200;

    /** The relay, in Python's standard library only: the serial port in raw mode, locked against a second session, joined to standard input and output. */
    private static readonly RELAY = `import fcntl, os, select, sys, termios

port, baud = sys.argv[1], int(sys.argv[2])
fd = os.open(port, os.O_RDWR | os.O_NOCTTY | os.O_NONBLOCK)

try:
    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
except OSError:
    sys.stderr.write("busy: another session holds " + port + "\\n")
    sys.exit(3)

attrs = termios.tcgetattr(fd)
attrs[0] = attrs[1] = attrs[3] = 0
attrs[2] = termios.CS8 | termios.CREAD | termios.CLOCAL
attrs[4] = attrs[5] = getattr(termios, "B%d" % baud)
termios.tcsetattr(fd, termios.TCSANOW, attrs)
termios.tcflush(fd, termios.TCIOFLUSH)

sys.stderr.write("ready\\n")
sys.stderr.flush()

while True:
    ready, _, _ = select.select([0, fd], [], [])

    if 0 in ready:
        data = os.read(0, 4096)
        if not data:
            break
        while data:
            try:
                data = data[os.write(fd, data):]
            except BlockingIOError:
                select.select([], [fd], [])

    if fd in ready:
        try:
            data = os.read(fd, 4096)
        except BlockingIOError:
            continue
        if data:
            os.write(1, data)
`;

    /** The relay for a console on this computer under Windows, in PowerShell, which has no termios but has .NET's serial port. */
    private static readonly WINDOWS_RELAY = `
$port = New-Object System.IO.Ports.SerialPort $env:CIRCUIT_PORT, ([int]$env:CIRCUIT_BAUD), 'None', 8, 'One'
try { $port.Open() } catch [System.UnauthorizedAccessException] { [Console]::Error.WriteLine("busy: another program holds " + $env:CIRCUIT_PORT); exit 3 } catch { [Console]::Error.WriteLine("cannot open " + $env:CIRCUIT_PORT + ": " + $_.Exception.Message); exit 2 }
[Console]::Error.WriteLine("ready")
$in = [Console]::OpenStandardInput()
$out = [Console]::OpenStandardOutput()
$buffer = New-Object byte[] 4096
$reading = $in.ReadAsync($buffer, 0, $buffer.Length)
while ($true) {
    if ($reading.IsCompleted) {
        if ($reading.Result -le 0) { break }
        $port.Write($buffer, 0, $reading.Result)
        $reading = $in.ReadAsync($buffer, 0, $buffer.Length)
    }
    $waiting = $port.BytesToRead
    if ($waiting -gt 0) {
        $data = New-Object byte[] $waiting
        $got = $port.Read($data, 0, $waiting)
        $out.Write($data, 0, $got)
        $out.Flush()
    } else {
        Start-Sleep -Milliseconds 10
    }
}
$port.Close()
`;

    /** A serial port: a path under /dev, checked because it goes into a shell command, or a Windows COM port. */
    private static readonly PORT = /^\/dev\/[\w./:+-]+$/;
    private static readonly WINDOWS_PORT = /^COM\d+$/i;

    /** Terminal escape sequences: cursor moves, screen clears, character sets, and modes. */
    private static readonly ESCAPES = /\u001b(?:\[[0-9;?]*[A-Za-z]|[()][A-Z0-9]|[=>78c])/g;

    /** A session to a jump host, through `cloudflared access ssh` when it sits behind a Cloudflare Tunnel. Its host key is checked as a device's is. */
    private static connectJump(jump: Jump): Promise<Client> {
        return new Promise((done, fail) => {
            const port = jump.port ?? Ssh.PORT;
            const hostKey = Ssh.hostKey(jump.host, port);
            const client = new Client();
            const login = {
                username: jump.user,
                password: Secrets.reveal(jump.password),
                readyTimeout: Ssh.READY_TIMEOUT_MS,
                ...hostKey.options,
            };

            client.on("ready", () => done(client)).on("error", (error) => fail(hostKey.explain(error)));

            if (!jump.cloudflared) {
                client.connect({ ...login, host: jump.host, port });
                return;
            }

            const tunnel = spawn("cloudflared", ["access", "ssh", "--hostname", jump.host], { stdio: ["pipe", "pipe", "ignore"] });
            tunnel.on("error", (error) => fail(new Error(`cloudflared did not start: ${error.message}`)));
            client.on("close", () => tunnel.kill());

            client.connect({ ...login, sock: Duplex.from({ readable: tunnel.stdout, writable: tunnel.stdin }) });
        });
    }

    /** A port another program holds is tried again `attempts` times in all, then fails with a message that starts with `busy:`. */
    static async open(console: Console, attempts = 5): Promise<ConsoleSession> {
        const windows = !console.jump && process.platform === "win32";
        if (windows ? !SerialConsole.WINDOWS_PORT.test(console.port) : !SerialConsole.PORT.test(console.port)) {
            throw new Error(`console port ${console.port} is not ${windows ? "a COM port" : "a path under /dev"}`);
        }
        if (!Number.isInteger(console.baud) || console.baud <= 0) throw new Error(`console baud ${console.baud} is not a line speed`);

        // The relay of a session that just ended can hold the port a few seconds more, until its host sees it gone.
        for (let attempt = 1; ; attempt++) {
            try {
                return await (console.jump ? SerialConsole.openOnJump(console, console.jump) : SerialConsole.openHere(console));
            } catch (error) {
                const busy = /busy: .*/.exec((error as Error).message);
                if (busy && attempt >= attempts) throw new Error(busy[0], { cause: error });
                if (!busy) throw error;
                await new Promise((done) => setTimeout(done, SerialConsole.BUSY_RETRY_MS));
            }
        }
    }

    private static async openOnJump(console: Console, jump: Jump): Promise<ConsoleSession> {
        const client = await SerialConsole.connectJump(jump);

        try {
            const encoded = Buffer.from(SerialConsole.RELAY).toString("base64");
            await Ssh.exec(
                client,
                `sh -c 'printf %s ${encoded} | base64 -d > ${SerialConsole.RELAY_PATH}'`,
                SerialConsole.RELAY_TIMEOUT_MS
            );

            const channel = await new Promise<ClientChannel>((done, fail) => {
                client.exec(`python3 ${SerialConsole.RELAY_PATH} ${console.port} ${console.baud}`, (error, stream) =>
                    error ? fail(error) : done(stream)
                );
            });

            await SerialConsole.relayReady(channel);

            return {
                channel: SerialConsole.asTerminal(channel),
                // What was written last, such as a logout, is still on its way to the device, so the relay ends once the console goes quiet.
                close: () =>
                    SerialConsole.quiet(channel, SerialConsole.SILENCE_MS).then(() => {
                        channel.end();
                        client.end();
                    }),
            };
        } catch (error) {
            client.end();
            throw error;
        }
    }

    /** The relay as a child process: Python on Linux and macOS, PowerShell on Windows. */
    private static async openHere(console: Console): Promise<ConsoleSession> {
        const child =
            process.platform === "win32"
                ? spawn("powershell", ["-NoProfile", "-NonInteractive", "-Command", SerialConsole.WINDOWS_RELAY], {
                      env: { ...process.env, CIRCUIT_PORT: console.port, CIRCUIT_BAUD: String(console.baud) },
                  })
                : spawn("python3", ["-c", SerialConsole.RELAY, console.port, String(console.baud)]);

        // The child's streams, in the shape an SSH channel has.
        const channel = Object.assign(new EventEmitter(), {
            stderr: child.stderr,
            write: (data: string | Buffer) => child.stdin.write(data),
            end: () => child.stdin.end(),
        });
        child.stdout.on("data", (chunk: Buffer) => channel.emit("data", chunk));
        child.on("close", () => channel.emit("close"));
        child.on("error", (error) => channel.emit("close", error));

        const asChannel = channel as unknown as ClientChannel;

        try {
            await SerialConsole.relayReady(asChannel);
        } catch (error) {
            child.kill();
            throw error;
        }

        return {
            channel: SerialConsole.asTerminal(asChannel),
            close: () =>
                SerialConsole.quiet(asChannel, SerialConsole.SILENCE_MS).then(() => {
                    channel.end();
                    setTimeout(() => child.kill(), SerialConsole.KILL_AFTER_MS).unref();
                }),
        };
    }

    /** Wait until the relay says it holds the port, or why it cannot. */
    private static relayReady(channel: ClientChannel): Promise<void> {
        return new Promise((done, fail) => {
            let said = "";
            const limit = setTimeout(
                () => fail(new Error(`the console relay did not start: ${said.trim()}`)),
                SerialConsole.RELAY_TIMEOUT_MS
            );

            channel.stderr.on("data", (chunk: Buffer) => {
                said += chunk.toString("utf8");
                if (said.includes("ready")) {
                    clearTimeout(limit);
                    done();
                }
            });
            channel.on("close", () => {
                clearTimeout(limit);
                fail(new Error(`the console relay stopped: ${said.trim() || "no reason given"}`));
            });
        });
    }

    /** A terminal ends a line with a carriage return. Adapters write lines as they do over SSH, and the console gets what a keyboard would send. */
    private static asTerminal(channel: ClientChannel): ClientChannel {
        const write = channel.write.bind(channel);
        channel.write = ((data: unknown, ...rest: unknown[]) =>
            write(typeof data === "string" ? data.replace(/\r?\n/g, "\r") : data, ...(rest as []))) as typeof channel.write;
        return channel;
    }

    /** A device's console and its login, for `--console`. */
    static of(device: Device) {
        const { console, user, password } = Secrets.loginOf(device);
        if (!console) throw new Error(`${device.name}: no connection.console`);

        return { console, user, password: password() };
    }

    /**
     * Write, then wait until what the console printed since ends with one of the patterns.
     *
     * With `settle`, a match counts only after `settle` milliseconds with no more output. So a line mid-output that looks like a prompt does not end it.
     */
    static expect(channel: Channel, write: string, patterns: readonly RegExp[], timeout = 30_000, settle = 0) {
        return new Promise<{ index: number; text: string }>((done, fail) => {
            let text = "";
            let settled: ReturnType<typeof setTimeout> | undefined;

            const stop = () => {
                clearTimeout(limit);
                clearTimeout(settled);
                channel.removeListener("data", onData);
            };

            const onData = (chunk: Buffer) => {
                // Escape sequences only clear the screen or move the cursor, so they are dropped.
                text += chunk.toString("utf8").replace(/\r/g, "").replace(SerialConsole.ESCAPES, "");
                clearTimeout(settled);

                const index = patterns.findIndex((pattern) => pattern.test(text));
                if (index === -1) return;

                const finish = () => {
                    stop();
                    done({ index, text });
                };

                if (settle) settled = setTimeout(finish, settle);
                else finish();
            };

            const limit = setTimeout(() => {
                stop();
                fail(new Error(`the console did not answer: ${text.slice(-SerialConsole.ERROR_TAIL_CHARS)}`));
            }, timeout);

            channel.on("data", onData);
            if (write) channel.write(write);
        });
    }

    /**
     * Log in on a console, whatever state the last session left it in. A state in `others` is moved on, and a session left open is logged out, so every login starts fresh. Returns once the CLI's prompt shows. With `passwordOnly`, no name is typed.
     */
    static async login(channel: Channel, dialect: ConsoleDialect, user: string, password: string, passwordOnly = false): Promise<void> {
        const others = dialect.others ?? [];
        const states = [dialect.login, dialect.password, ...others.map(([pattern]) => pattern), dialect.prompt];

        // What to send in each state to get closer to a login prompt: Enter at a password prompt fails the login and asks again.
        const toward = (index: number) => {
            if (index === 1) return "\n";
            if (index < 2 + others.length) return others[index - 2]![1];
            return `${dialect.logout}\n`;
        };

        // What the last session printed as it left, such as a login prompt after its logout, arrives late. It must not be taken for an answer.
        await SerialConsole.quiet(channel, SerialConsole.SILENCE_MS);

        // The prompt a fresh login starts at: the login prompt, or the password prompt when there is no name to type.
        const start = passwordOnly ? 1 : 0;

        let state = (await SerialConsole.expect(channel, "\n", states)).index;
        for (let step = 0; state !== start; step++) {
            if (passwordOnly && state === 0)
                throw new Error("the console asks for a name, but its console is set to ask only for a password");
            if (step >= SerialConsole.LOGIN_STEPS)
                throw new Error(`the console never reached a ${passwordOnly ? "password" : "login"} prompt`);
            state = (await SerialConsole.expect(channel, toward(state), states)).index;
        }

        // A console can print the login prompt more than once, and a name typed while it does is lost.
        await SerialConsole.quiet(channel, SerialConsole.SILENCE_MS);

        if (!passwordOnly) {
            const name = dialect.user ? dialect.user(user) : user;
            if ((await SerialConsole.expect(channel, `${name}\n`, [dialect.password, dialect.login, dialect.prompt])).index !== 0) {
                throw new Error("the console did not ask for a password");
            }
        }

        // A platform may ask something once logged in, such as whether to read a license, and `others` answers it. A refusal is checked first, since the banner after it matches one of `others`.
        const refusal = dialect.refused ? [dialect.refused] : [];
        const first = 2 + refusal.length;
        const answers = [dialect.prompt, dialect.login, ...refusal, ...others.map(([pattern]) => pattern)];

        let answer = await SerialConsole.expect(channel, `${password}\n`, answers, SerialConsole.PASSWORD_TIMEOUT_MS);
        for (let step = 0; answer.index >= first; step++) {
            if (step >= SerialConsole.LOGIN_QUESTIONS) throw new Error("the console kept asking after the login");
            answer = await SerialConsole.expect(channel, others[answer.index - first]![1], answers);
        }

        if (answer.index === 1) throw new Error(`the console refused the login of ${user}`);
        if (answer.index === 2 && dialect.refused) throw new Error("the console refused the password");

        // Some consoles print the prompt twice after a login, and what arrives late must not reach the first command.
        await SerialConsole.quiet(channel, SerialConsole.LOGIN_SILENCE_MS);
    }

    /** Wait until the console has printed nothing for `silence` milliseconds, dropping what it printed, or until `SILENCE_LIMIT_MS`. */
    private static quiet(channel: Channel, silence: number): Promise<void> {
        return new Promise((done) => {
            let timer = setTimeout(finish, silence);
            const limit = setTimeout(finish, SerialConsole.SILENCE_LIMIT_MS);

            function finish() {
                clearTimeout(timer);
                clearTimeout(limit);
                channel.removeListener("data", onData);
                done();
            }

            function onData() {
                clearTimeout(timer);
                timer = setTimeout(finish, silence);
            }

            channel.on("data", onData);
        });
    }

    /** Write, then collect what the console prints until it is quiet for `silence` milliseconds, or for `limit` in all. Carriage returns and escape sequences are dropped. */
    static listen(channel: Channel, write: string, silence: number, limit = 300_000): Promise<string> {
        return new Promise((done) => {
            let text = "";
            let timer = setTimeout(finish, silence);
            const cap = setTimeout(finish, limit);

            function finish() {
                clearTimeout(timer);
                clearTimeout(cap);
                channel.removeListener("data", onData);
                done(text);
            }

            function onData(chunk: Buffer) {
                text += chunk.toString("utf8").replace(/\r/g, "").replace(SerialConsole.ESCAPES, "");
                clearTimeout(timer);
                timer = setTimeout(finish, silence);
            }

            channel.on("data", onData);
            if (write) channel.write(write);
        });
    }

    /** The text after a command's echo. A terminal wraps a long echo where it likes, so the echo is matched character by character, line breaks it added skipped. */
    static afterEcho(text: string, command: string): string {
        // The echo can follow a prompt that arrived late, so it is looked for wherever the command's first character is.
        for (let start = text.indexOf(command[0] ?? ""); start >= 0; start = text.indexOf(command[0]!, start + 1)) {
            const end = SerialConsole.echoEnd(text, command, start);
            if (end !== undefined) return text.slice(end).replace(/^\r?\n/, "");
        }

        return text;
    }

    /** Where the command's echo from `start` ends, or undefined when the text there is not its echo. */
    private static echoEnd(text: string, command: string, start: number): number | undefined {
        let at = start;

        for (const character of command) {
            while (at < text.length && text[at] !== character && /[\r\n]/.test(text[at]!)) at++;
            if (text[at] !== character) return undefined;
            at++;
        }

        return at;
    }
}

/** A CLI on a console or in an SSH shell, run one command at a time. Each returns what it printed, as an SSH exec would: no echo, no prompt. */
export class ConsoleShell {
    /** The quiet after the prompt, in milliseconds, when output can hold a line that looks like it, as in `circuit exec`. */
    static readonly SETTLE = 1000;

    constructor(
        private readonly channel: Channel,
        private readonly dialect: ConsoleDialect,
        /** Milliseconds of quiet after the prompt shows before a command counts as done. */
        private readonly settle = 0
    ) {}

    /** A pager in `others` is answered as it shows. */
    async run(command: string, timeout = 120_000): Promise<string> {
        const pagers = (this.dialect.others ?? []).filter(([, reply]) => !reply.endsWith("\n"));
        const patterns = [this.dialect.prompt, ...pagers.map(([pattern]) => pattern)];

        let { index, text } = await SerialConsole.expect(this.channel, `${command}\n`, patterns, timeout, this.settle);
        let output = "";

        // A pager's answer goes without a new line, and the pager's own text is dropped.
        while (index > 0) {
            const [pattern, reply] = pagers[index - 1]!;
            output += text.replace(pattern, "");
            ({ index, text } = await SerialConsole.expect(this.channel, reply, patterns, timeout, this.settle));
        }
        output += text;

        const lines = SerialConsole.afterEcho(output, command).split("\n");
        return lines.slice(0, -1).join("\n");
    }

    logout(): void {
        this.channel.write(`${this.dialect.logout}\n`);
    }
}

/** One line for `circuit access-console`. `onlyAfter` is the text the last answer must end with for the line to be sent. */
export type ScriptLine = { text: string; quiet: number; onlyAfter?: string };

/**
 * Lines sent to a console one at a time, as a person would type them, each answer read until the console goes quiet.
 *
 * A line may start with `@if=TEXT=>`: it is sent only when the last answer ends with TEXT, for a prompt that may or may not come. Then, or alone, `@wait=N:` waits for N seconds of quiet instead of the usual 1.5, for a slow command.
 */
export class ConsoleScript {
    /** The quiet that ends an answer. */
    static readonly QUIET_MS = 1500;

    private static readonly MS_PER_SECOND = 1000;

    /** A line as written, with `quiet` for a line that has no `@wait=`. */
    static parse(line: string, quiet = ConsoleScript.QUIET_MS): ScriptLine {
        let text = line;
        let onlyAfter: string | undefined;

        const condition = /^@if=(.*?)=>/s.exec(text);
        if (condition) {
            onlyAfter = condition[1]!;
            text = text.slice(condition[0].length);
        }

        const wait = /^@wait=(\d+(?:\.\d+)?):/.exec(text);
        if (wait) {
            text = text.slice(wait[0].length);
        }

        const silence = wait ? Number(wait[1]) * ConsoleScript.MS_PER_SECOND : quiet;
        return { text, quiet: silence, ...(onlyAfter === undefined ? {} : { onlyAfter }) };
    }

    /** Each answer goes to `answered` as it comes. A line whose condition does not hold is skipped. */
    static async run(
        channel: Channel,
        lines: readonly string[],
        answered: (answer: string) => void,
        quiet = ConsoleScript.QUIET_MS
    ): Promise<void> {
        let last = "";

        for (const line of lines.map((written) => ConsoleScript.parse(written, quiet))) {
            if (line.onlyAfter !== undefined && !last.trimEnd().endsWith(line.onlyAfter.trimEnd())) continue;

            last = await SerialConsole.listen(channel, `${line.text}\n`, line.quiet);
            answered(last);
        }
    }
}
