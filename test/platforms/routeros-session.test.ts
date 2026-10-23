// RouterOS read and apply over a real SSH session, against a fake device that answers like RouterOS 7: the version check, the export, the dry parse of each command, the backup and rollback, and the fresh login that proves access.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { Platforms } from "../../src/platforms";
import type { Device } from "../../src/schema";
import router from "../../templates/single-site/router";
import { FakeSshDevice } from "./fake-ssh";

const platform = Platforms.get("routeros");
const options = { secrets: false, rollback: 10 };

const desired: Device = { ...router, connection: { host: "127.0.0.1", user: "operator" } };
const before: Device = { ...desired, ports: { ...desired.ports, "25g-1": { ...desired.ports!["25g-1"]!, description: "Old switch" } } };

let version = "7.23.5";
let running = platform.render(before);

/** What RouterOS prints for a command. Any command that is not a read, a dry parse or the rollback guard changes it to the desired config. */
const fake = new FakeSshDevice("operator", (command) => {
    if (command === ":put [/system resource get version]") return `${version}\n`;
    if (command === "/export") return `# 2026-10-23 10:00:00 by RouterOS ${version}\n${running}`;
    if (command === "/user export" || command.startsWith(":foreach c in=[/certificate find]")) return "";
    if (command.startsWith(":put [:parse ")) return "(evaluate)\n";
    if (/^\/system (backup|scheduler)|^\/file remove/.test(command)) return "";

    running = platform.render(desired);
    return "";
});

let device: Device;

beforeAll(async () => {
    process.env.ROUTER_PASSWORD = FakeSshDevice.PASSWORD;
    device = { ...desired, connection: { ...desired.connection, port: await fake.listen() } };
});

afterAll(() => fake.close());

test("a read and an apply over SSH change only what differs, guarded by a backup and a fresh login, and converge", async () => {
    const plan = platform.plan(platform.render(device), await platform.read(device, [device]), options);
    expect(plan.steps.flatMap((step) => step.send)).toEqual(["/interface ethernet set [ find default-name=sfp28-1 ] comment=Switch"]);

    await platform.apply(device, [device], plan, options);

    const sent = fake.commands.filter((command) => !command.startsWith(":put [:parse ") && !command.startsWith(":foreach"));
    expect(sent).toContain("/interface ethernet set [ find default-name=sfp28-1 ] comment=Switch");
    expect(sent.some((command) => command.startsWith("/system backup save name=pre-apply-"))).toBe(true);
    expect(sent.filter((command) => command === '/system scheduler remove [find name="apply-rollback"]')).toHaveLength(2);
    expect(sent.at(-1)).toMatch(/^\/file remove \[find name="pre-apply-\d+\.backup"\]$/);

    const again = platform.plan(platform.render(device), await platform.read(device, [device]), options);
    expect(again.steps).toEqual([]);
});

test("a RouterOS 6 device is refused before anything is read", async () => {
    version = "6.49.10";
    const count = fake.commands.length;

    await expect(platform.read(device, [device])).rejects.toThrow("router runs RouterOS 6.49.10; this adapter renders for version 7");
    expect(fake.commands.slice(count)).toEqual([":put [/system resource get version]"]);

    version = "7.23.5";
});
