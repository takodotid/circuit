// Serial consoles on a jump host. Circuit logs in to the jump host over SSH and starts a small relay there, which joins the serial port to the session. The device's CLI then streams through it as through an SSH shell.

import { spawn } from "node:child_process";
import { Duplex } from "node:stream";
import { Client, type ClientChannel } from "ssh2";
import { resolve } from "../core/secrets";
import type { Console, Jump } from "../schema";
import { exec } from "./ssh";

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

const RELAY_PATH = "/tmp/circuit-console.py";

/** A serial port path the relay is started with, which reaches the jump host's shell. */
const PORT = /^\/dev\/[\w./:+-]+$/;

/** A session to a jump host, through `cloudflared access ssh` when it sits behind a Cloudflare Tunnel. */
function connectJump(jump: Jump): Promise<Client> {
    return new Promise((done, fail) => {
        const client = new Client();
        const login = { username: jump.user, password: resolve(jump.password), readyTimeout: 60_000 };

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

/** An open console: the stream to the device's CLI, and how to let it go. */
export type ConsoleSession = { channel: ClientChannel; close: () => void };

/** Open a device's serial console through its jump host. Fails when another session holds the port. */
export async function openConsole(console: Console): Promise<ConsoleSession> {
    if (!PORT.test(console.port)) throw new Error(`console port ${console.port} is not a path under /dev`);
    if (!Number.isInteger(console.baud) || console.baud <= 0) throw new Error(`console baud ${console.baud} is not a line speed`);

    const client = await connectJump(console.jump);

    try {
        const encoded = Buffer.from(RELAY).toString("base64");
        await exec(client, `sh -c 'printf %s ${encoded} | base64 -d > ${RELAY_PATH}'`, 30_000);

        const channel = await new Promise<ClientChannel>((done, fail) => {
            client.exec(`python3 ${RELAY_PATH} ${console.port} ${console.baud}`, (error, stream) => (error ? fail(error) : done(stream)));
        });

        // The relay says it is ready once it holds the port, or why it cannot.
        await new Promise<void>((done, fail) => {
            let said = "";
            const limit = setTimeout(() => fail(new Error(`the console relay did not start: ${said.trim()}`)), 30_000);

            channel.stderr.on("data", (chunk: Buffer) => {
                said += chunk.toString("utf8");
                if (said.includes("ready\n")) {
                    clearTimeout(limit);
                    done();
                }
            });
            channel.on("close", () => {
                clearTimeout(limit);
                fail(new Error(`the console relay stopped: ${said.trim() || "no reason given"}`));
            });
        });

        return {
            channel,
            close: () => {
                channel.end();
                client.end();
            },
        };
    } catch (error) {
        client.end();
        throw error;
    }
}
