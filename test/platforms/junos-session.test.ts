// Junos read and apply over a real SSH session, against a fake device that answers like Junos 21.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { connect, createServer } from "node:net";
import type { AddressInfo } from "node:net";
import type { Device } from "../../src/model";
import { Platforms } from "../../src/platforms";
import type { Plan } from "../../src/platforms/platform";
import { Ssh } from "../../src/transport/ssh";
import { Fixtures } from "../fixtures";
import { FakeSshDevice } from "./fake-ssh";

const platform = Platforms.get("junos");
const aggregationSwitch = Fixtures.device("platforms--example-aggregation-switch");
let version = "21.4R3-S1.6";

/** Where the CLI is: a load takes statements without a prompt. */
let mode: "operational" | "configuration" | "load" = "operational";

/** How many logins the switch resets once a `commit confirmed` is in, as a QFX5100 did (TRAPS.md). */
let resetsAfterCommit = 0;
let resets = 0;
let logins = 0;

const fake = new FakeSshDevice(
    "netops",
    (command) => {
        if (command === "show version | match Junos:") return `Junos: ${version}\n`;
        if (command === "show configuration | display set | no-more") return `set version 21.4R3-S1.6\n${platform.render(device)}`;

        if (command === "configure exclusive") {
            mode = "configuration";
            return "Entering configuration mode\n";
        }
        if (command === "exit configuration-mode") {
            mode = "operational";
            return "Exiting configuration mode\n";
        }
        if (command === "load set terminal") {
            mode = "load";
            return "[Type ^D at a new line to end input]\n";
        }
        if (command === "\u0004") {
            mode = "configuration";
            return "load complete\n";
        }
        if (command === "commit check") return "configuration check succeeds\n";
        if (command.startsWith("commit confirmed ")) {
            resets = resetsAfterCommit;
            return "commit confirmed will be automatically rolled back in 10 minutes unless confirmed\ncommit complete\n";
        }
        if (command.startsWith("commit ")) return "commit complete\n";
        if (command === "rollback 1") return "load complete\n";
        if (mode !== "operational") return "";
        if (command.startsWith("set cli ")) return "";

        return `error: unknown command: ${command}\n`;
    },
    {
        banner: "netops@qfx> ",
        prompt: () => ({ operational: "netops@qfx> ", configuration: "\n[edit]\nnetops@qfx# ", load: "" })[mode],
    }
);

/** In front of the fake: it resets the login it is told to, before the SSH handshake. */
const front = createServer((socket) => {
    logins++;
    if (resets > 0) {
        resets--;
        socket.resetAndDestroy();
        return;
    }

    const upstream = connect(fakePort, "127.0.0.1");
    socket.pipe(upstream).pipe(socket);
    socket.on("error", () => upstream.destroy());
    upstream.on("error", () => socket.destroy());
});

const proofPauseMs = Ssh.proofPauseMs;
const TEST_PAUSE_MS = 10;

const plan: Plan = { steps: [{ title: "interfaces", show: [], send: ["set interfaces xe-0/0/1 description Uplink"] }], problems: [] };
const options = { secrets: false, rollback: 10 };

let device: Device;
let fakePort = 0;

beforeAll(async () => {
    process.env.EXAMPLE_NETOPS_PASSWORD = FakeSshDevice.PASSWORD;
    Ssh.proofPauseMs = TEST_PAUSE_MS;
    fakePort = await fake.listen();
    await new Promise<void>((done) => front.listen(0, "127.0.0.1", done));
    device = { ...aggregationSwitch, connection: { host: "127.0.0.1", port: (front.address() as AddressInfo).port, user: "netops" } };
});

afterAll(() => {
    delete process.env.EXAMPLE_NETOPS_PASSWORD;
    Ssh.proofPauseMs = proofPauseMs;
    front.close();
    fake.close();
});

test("a read over SSH checks the version, drops what the device adds by itself, and plans nothing against the render", async () => {
    const current = await platform.read(device, [device]);

    expect(fake.commands).toEqual(["show version | match Junos:", "show configuration | display set | no-more"]);
    expect(current).not.toContain("set version");
    expect(platform.plan(platform.render(device), current, { secrets: false, rollback: 10 }).steps).toEqual([]);
});

test("a device on another major version is refused before the configuration is read", async () => {
    version = "18.4R2";
    const count = fake.commands.length;

    await expect(platform.read(device, [device])).rejects.toThrow("runs Junos 18.4R2; this adapter renders for Junos 21");
    expect(fake.commands.slice(count)).toEqual(["show version | match Junos:"]);

    version = "21.4R3-S1.6";
});

test("a proof login the switch resets right after the commit is tried again, and the commit is confirmed", async () => {
    resetsAfterCommit = 1;
    const count = fake.shellLines.length;
    logins = 0;

    await platform.apply(device, [device], plan, options);

    const typed = fake.shellLines.slice(count);
    expect(typed).toContain("commit comment circuit-confirmed");
    expect(typed).not.toContain("rollback 1");
    // The session, the login it reset, and the one that passed.
    expect(logins).toBe(3);
});

test("a proof login the switch resets on every try rolls the commit back", async () => {
    resetsAfterCommit = Ssh.PROOF_TRIES;
    const count = fake.shellLines.length;
    logins = 0;

    await expect(platform.apply(device, [device], plan, options)).rejects.toThrow(
        `a fresh login failed (read ECONNRESET, on all ${Ssh.PROOF_TRIES} tries); the previous configuration is restored`
    );

    const typed = fake.shellLines.slice(count);
    expect(typed).toContain("rollback 1");
    expect(typed).toContain("commit comment circuit-restore");
    expect(typed).not.toContain("commit comment circuit-confirmed");
    expect(logins).toBe(1 + Ssh.PROOF_TRIES);
});
