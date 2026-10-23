// Junos read over a real SSH session, against a fake device that answers like Junos 21: the version check, then the configuration as set statements.

import { afterAll, beforeAll, expect, test } from "bun:test";
import aggregationSwitch from "../../examples/platforms/junos";
import { Platforms } from "../../src/platforms";
import type { Device } from "../../src/schema";
import { FakeSshDevice } from "./fake-ssh";

const platform = Platforms.get("junos");
let version = "21.4R3-S1.6";

const fake = new FakeSshDevice("netops", (command) => {
    if (command === "show version | match Junos:") return `Junos: ${version}\n`;
    if (command === "show configuration | display set | no-more") return `set version 21.4R3-S1.6\n${platform.render(device)}`;

    return `error: unknown command: ${command}\n`;
});

let device: Device;

beforeAll(async () => {
    process.env.EXAMPLE_NETOPS_PASSWORD = FakeSshDevice.PASSWORD;
    device = { ...aggregationSwitch, connection: { host: "127.0.0.1", port: await fake.listen(), user: "netops" } };
});

afterAll(() => fake.close());

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
