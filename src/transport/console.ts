// Serial consoles, on a jump host or on this computer. A small relay joins the serial port to a stream: started over SSH on the jump host, or here as a child process. The device's CLI then streams through it as through an SSH shell.

import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { Duplex } from "node:stream";
import { Client, type ClientChannel } from "ssh2";
import { Secrets } from "../core/secrets";
import type { Console, Device, Jump } from "../schema";
import { Ssh } from "./ssh";

/** The relay, in Python's standard library only: the serial port in raw mode, locked against a second session, joined to standard input and output. */
const RELAY = `import fcntl, os, select, sys, termios

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
const WINDOWS_RELAY = `
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

/** An open console: the stream to the device's CLI, and how to let it go. */
export type ConsoleSession = { channel: ClientChannel; close: () => void };

/** How a platform's console asks for a login and shows its prompt, and what moves it on from anywhere else. */
export type ConsoleDialect = {
    /** The login prompt. */
    login: RegExp;
    /** The password prompt. */
    password: RegExp;
    /** The CLI's prompt once logged in. */
    prompt: RegExp;
    /** What logs out from the prompt. */
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

    /** A serial port the relay is started with: a path under /dev, which reaches a shell, or a Windows COM port. */
    private static readonly PORT = /^\/dev\/[\w./:+-]+$/;
    private static readonly WINDOWS_PORT = /^COM\d+$/i;

    /** Terminal escape sequences: cursor moves, screen clears, character sets and modes. */
    private static readonly ESCAPES = /\u001b(?:\[[0-9;?]*[A-Za-z]|[()][A-Z0-9]|[=>78c])/g;

    /** A session to a jump host, through `cloudflared access ssh` when it sits behind a Cloudflare Tunnel. */
    private static connectJump(jump: Jump): Promise<Client> {
        return new Promise((done, fail) => {
            const client = new Client();
            const login = { username: jump.user, password: Secrets.reveal(jump.password), readyTimeout: 60_000 };

            client.on("ready", () => done(client)).on("error", fail);

            if (!jump.cloudflared) {
                client.connect({ ...login, host: jump.host, port: jump.port ?? 22 });
                return;
            }

            const tunnel = spawn("cloudflared", ["access", "ssh", "--hostname", jump.host], { stdio: ["pipe", "pipe", "ignore"] });
            tunnel.on("error", (error) => fail(new Error(`cloudflared did not start: ${error.message}`)));
            client.on("close", () => tunnel.kill());

            client.connect({ ...login, sock: Duplex.from({ readable: tunnel.stdout, writable: tunnel.stdin }) });
        });
    }

    /** Open a device's serial console, through its jump host or on this computer. Fails when another session holds the port. */
    static async open(console: Console): Promise<ConsoleSession> {
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
                if (attempt >= 5 || !/busy:/.test((error as Error).message)) throw error;
                await new Promise((done) => setTimeout(done, 5_000));
            }
        }
    }

    private static async openOnJump(console: Console, jump: Jump): Promise<ConsoleSession> {
        const client = await SerialConsole.connectJump(jump);

        try {
            const encoded = Buffer.from(RELAY).toString("base64");
            await Ssh.exec(client, `sh -c 'printf %s ${encoded} | base64 -d > ${SerialConsole.RELAY_PATH}'`, 30_000);

            const channel = await new Promise<ClientChannel>((done, fail) => {
                client.exec(`python3 ${SerialConsole.RELAY_PATH} ${console.port} ${console.baud}`, (error, stream) =>
                    error ? fail(error) : done(stream)
                );
            });

            await SerialConsole.relayReady(channel);

            return {
                channel: SerialConsole.asTerminal(channel),
                // What was written last, such as a logout, is still on its way to the device; the relay ends once the console goes quiet.
                close: () => {
                    void SerialConsole.quiet(channel, 1_000).then(() => {
                        channel.end();
                        client.end();
                    });
                },
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
                ? spawn("powershell", ["-NoProfile", "-NonInteractive", "-Command", WINDOWS_RELAY], {
                      env: { ...process.env, CIRCUIT_PORT: console.port, CIRCUIT_BAUD: String(console.baud) },
                  })
                : spawn("python3", ["-c", RELAY, console.port, String(console.baud)]);

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
            close: () => {
                void SerialConsole.quiet(asChannel, 1_000).then(() => {
                    channel.end();
                    setTimeout(() => child.kill(), 2_000).unref();
                });
            },
        };
    }

    /** Wait until the relay says it holds the port, or why it cannot. */
    private static relayReady(channel: ClientChannel): Promise<void> {
        return new Promise((done, fail) => {
            let said = "";
            const limit = setTimeout(() => fail(new Error(`the console relay did not start: ${said.trim()}`)), 30_000);

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

        return { console, user, password };
    }

    /** Write, then wait until what the console printed since ends with one of the patterns. Returns which, and what was printed. */
    static expect(channel: Channel, write: string, patterns: readonly RegExp[], timeout = 30_000) {
        return new Promise<{ index: number; text: string }>((done, fail) => {
            let text = "";

            const stop = () => {
                clearTimeout(limit);
                channel.removeListener("data", onData);
            };

            const onData = (chunk: Buffer) => {
                // A terminal's escape sequences, which clear the screen or move the cursor, say nothing a reader needs.
                text += chunk.toString("utf8").replace(/\r/g, "").replace(SerialConsole.ESCAPES, "");

                const index = patterns.findIndex((pattern) => pattern.test(text));
                if (index < 0) return;

                stop();
                done({ index, text });
            };

            const limit = setTimeout(() => {
                stop();
                fail(new Error(`the console did not answer: ${text.slice(-200)}`));
            }, timeout);

            channel.on("data", onData);
            if (write) channel.write(write);
        });
    }

    /**
     * Log in on a console, whatever state the last session left it in: what `others` names is moved on, a session left open is logged out, so every session starts from a fresh login. Returns once the CLI's prompt shows. A console that asks only for a password (`passwordOnly`) is logged in at its password prompt, with no name typed.
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

        // What the last session printed as it left, such as a login prompt after its logout, arrives late; it must not be taken for an answer.
        await SerialConsole.quiet(channel, 1_000);

        // The prompt a fresh login starts at: the login prompt, or the password prompt when there is no name to type.
        const start = passwordOnly ? 1 : 0;

        let state = (await SerialConsole.expect(channel, "\n", states)).index;
        for (let step = 0; state !== start; step++) {
            if (passwordOnly && state === 0)
                throw new Error("the console asks for a name, but its console is set to ask only for a password");
            if (step >= 10) throw new Error(`the console never reached a ${passwordOnly ? "password" : "login"} prompt`);
            state = (await SerialConsole.expect(channel, toward(state), states)).index;
        }

        // A console can print the login prompt more than once; a name typed while it does is lost.
        await SerialConsole.quiet(channel, 1_000);

        if (!passwordOnly) {
            const name = dialect.user ? dialect.user(user) : user;
            if ((await SerialConsole.expect(channel, `${name}\n`, [dialect.password, dialect.login, dialect.prompt])).index !== 0) {
                throw new Error("the console did not ask for a password");
            }
        }

        // A platform may ask something once logged in, such as whether to read a licence; `others` answers it. A refusal is checked before `others`, since the banner that follows it matches one of them.
        const refusal = dialect.refused ? [dialect.refused] : [];
        const first = 2 + refusal.length;
        const answers = [dialect.prompt, dialect.login, ...refusal, ...others.map(([pattern]) => pattern)];

        let answer = await SerialConsole.expect(channel, `${password}\n`, answers, 60_000);
        for (let step = 0; answer.index >= first; step++) {
            if (step >= 5) throw new Error("the console kept asking after the login");
            answer = await SerialConsole.expect(channel, others[answer.index - first]![1], answers);
        }

        if (answer.index === 1) throw new Error(`the console refused the login of ${user}`);
        if (answer.index === 2 && dialect.refused) throw new Error("the console refused the password");

        // Some consoles print the prompt twice after a login; what arrives late must not reach the first command.
        await SerialConsole.quiet(channel, 800);
    }

    /** Wait until the console has printed nothing for `silence` milliseconds, dropping what it printed, at most five seconds. */
    private static quiet(channel: Channel, silence: number): Promise<void> {
        return new Promise((done) => {
            let timer = setTimeout(finish, silence);
            const limit = setTimeout(finish, 5_000);

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

    /** The text after a command's echo. A terminal wraps a long echo where it likes, so the echo is matched character by character, line breaks it added skipped. */
    static afterEcho(text: string, command: string): string {
        // The echo can follow a prompt that arrived late, so it is looked for wherever the command's first character is.
        for (let start = text.indexOf(command[0] ?? ""); start >= 0; start = text.indexOf(command[0]!, start + 1)) {
            const end = SerialConsole.echoEnd(text, command, start);
            if (end !== undefined) return text.slice(end).replace(/^\r?\n/, "");
        }

        return text;
    }

    /** Where the echo of a command that starts at `start` ends, or undefined when the text there is not its echo. */
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

/** A CLI on a console that runs one command at a time and returns what it printed, as an SSH exec would: no echo, no prompt. */
export class ConsoleShell {
    constructor(
        private readonly channel: Channel,
        private readonly dialect: ConsoleDialect
    ) {}

    /** Run a command and wait for the prompt. A pager in `others` is answered as it shows. */
    async run(command: string, timeout = 120_000): Promise<string> {
        const pagers = (this.dialect.others ?? []).filter(([, reply]) => !reply.endsWith("\n"));
        const patterns = [this.dialect.prompt, ...pagers.map(([pattern]) => pattern)];

        let { index, text } = await SerialConsole.expect(this.channel, `${command}\n`, patterns, timeout);
        let output = "";

        // A pager stops the output; its answer goes on without a new line, and the pager's own text is dropped.
        while (index > 0) {
            const [pattern, reply] = pagers[index - 1]!;
            output += text.replace(pattern, "");
            ({ index, text } = await SerialConsole.expect(this.channel, reply, patterns, timeout));
        }
        output += text;

        const lines = SerialConsole.afterEcho(output, command).split("\n");
        return lines.slice(0, -1).join("\n");
    }

    /** Log out, so no session is left open on the console. */
    logout(): void {
        this.channel.write(`${this.dialect.logout}\n`);
    }
}
