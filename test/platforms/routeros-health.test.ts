// The checks after a RouterOS apply, over real SSH sessions against a fake device: no switch rule may be invalid when the plan touched them, and the BGP sessions established before must be established again.

import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { Platforms } from "../../src/platforms";
import type { Device } from "../../src/schema";
import edge from "../../templates/edge-router/edge-01";
import { FakeSshDevice } from "./fake-ssh";

const platform = Platforms.get("routeros");
const options = { secrets: false, rollback: 10 };
const quick = { bgp: { seconds: 0.5, every: 0.05 } };

const COUNT_INVALID = "/interface ethernet switch rule print count-only where invalid";

/** Before the apply, the SGIX port has no ACL, so the plan adds switch rules. */
const desired: Device = { ...edge, connection: { host: "127.0.0.1", user: "operator" } };
const before: Device = { ...desired, ports: { ...desired.ports, "25g-2": { description: "SGIX", access_vlan: "ix" } } };

let running: string;
let invalid: string;
/** The sessions the `:foreach` script prints, read by read: the last one stays. */
let sessionReads: string[][];

const fake = new FakeSshDevice(["operator", "operator+ct300w"], (command) => {
    if (command === ":put [/system resource get version]") return "7.23.5\n";
    if (command === "/export") return `# 2026-10-23 10:00:00 by RouterOS 7.23.5\n${running}`;
    if (command === "/user export" || command.startsWith(":foreach c in=[/certificate find]")) return "";
    if (command.startsWith(":put [:parse ")) return "(evaluate)\n";
    if (/^\/system (backup|scheduler)|^\/file remove/.test(command)) return "";
    if (command === COUNT_INVALID) return `${invalid}\n`;

    if (command.startsWith(":foreach s in=[/routing bgp session find]")) {
        const sessions = sessionReads.length > 1 ? sessionReads.shift()! : sessionReads[0]!;
        return sessions.join("\n") + "\n";
    }

    running = platform.render(desired);
    return "";
});

const UP = ["hurricane-electric-1|203.0.113.1|true|987654|1w2d", "sgix-rs-v4-1|192.0.2.1|true|1200|1w2d"];
const SGIX_DOWN = ["hurricane-electric-1|203.0.113.1|true|987654|1w2d", "sgix-rs-v4-1|192.0.2.1|false||"];

let device: Device;

beforeAll(async () => {
    process.env.EDGE_01_PASSWORD = FakeSshDevice.PASSWORD;
    device = { ...desired, connection: { ...desired.connection, port: await fake.listen() } };
});

beforeEach(() => {
    running = platform.render(before);
    invalid = "0";
    sessionReads = [UP];
});

afterAll(() => fake.close());

/** Plan against the fake, read the sessions, apply, and run the checks, as `circuit apply --confirm` does. */
async function applyAndCheck(): Promise<string[]> {
    const plan = platform.plan(platform.render(device), await platform.read(device, [device]), options);
    const health = await platform.health!(device, plan, quick);

    await platform.apply(device, [device], plan, options);
    return health.run();
}

test("an apply that adds switch rules and keeps BGP up finds no problem", async () => {
    const count = fake.commands.length;

    expect(await applyAndCheck()).toEqual([]);
    expect(fake.commands.slice(count)).toContain(COUNT_INVALID);
});

test("an invalid switch rule fails the check and says what to do", async () => {
    invalid = "3";

    const [problem, ...rest] = await applyAndCheck();
    expect(rest).toEqual([]);
    expect(problem).toStartWith("3 switch rule(s) are invalid");
    expect(problem).toContain("Use fewer distinct port ranges");
});

test("a session that comes back within the time is not a problem; one that does not is named", async () => {
    sessionReads = [UP, SGIX_DOWN, SGIX_DOWN, UP];
    expect(await applyAndCheck()).toEqual([]);

    running = platform.render(before);
    sessionReads = [UP, SGIX_DOWN];
    const problems = await applyAndCheck();
    expect(problems).toHaveLength(1);
    expect(problems[0]).toStartWith("BGP session sgix-rs-v4 was established before the apply and is not 0.5 s after it (connecting)");
});

test("a session down before the apply is not waited for, and a plan without switch rules does not count them", async () => {
    running = platform.render({ ...desired, ports: { ...desired.ports, "25g-1": { ...desired.ports!["25g-1"]!, description: "Old" } } });
    sessionReads = [SGIX_DOWN];
    const count = fake.commands.length;

    expect(await applyAndCheck()).toEqual([]);
    expect(fake.commands.slice(count)).not.toContain(COUNT_INVALID);
});
