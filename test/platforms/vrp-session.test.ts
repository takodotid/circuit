// VRP read over a real SSH shell, against a fake device that answers like a CE6855: the question about changing the password answered no, paging off, then the configuration.

import { afterAll, beforeAll, expect, test } from "bun:test";
import switchDevice from "../../examples/switch";
import { Platforms } from "../../src/platforms";
import type { Device } from "../../src/schema";
import { FakeSshDevice } from "./fake-ssh";

const platform = Platforms.get("vrp");
let device: Device;

const fake = new FakeSshDevice(
    "operator",
    (command) => {
        if (command === "display current-configuration") {
            return `!Software Version V200R005C00SPC800\r\n!Last configuration was updated at 2026-10-23 10:00:00+07:00\r\n${platform.render(device).replace(/\n/g, "\r\n")}`;
        }

        return "";
    },
    {
        banner: "Info: The password has not been changed for a long time.\r\nChange now? [Y/N]:",
        prompt: () => "\r\n<example-switch>",
    }
);

beforeAll(async () => {
    process.env.EXAMPLE_OPERATOR_PASSWORD = FakeSshDevice.PASSWORD;
    device = { ...switchDevice, connection: { host: "127.0.0.1", port: await fake.listen(), user: "operator" } };
});

afterAll(() => fake.close());

test("a read over SSH answers no to a new password, turns paging off, and plans nothing against the render", async () => {
    const current = await platform.read(device, [device]);

    expect(fake.commands).toEqual(["N", "screen-length 0 temporary", "display current-configuration"]);
    expect(current).not.toContain("!Last configuration");
    expect(platform.plan(platform.render(device), current, { secrets: false, rollback: 10 }).steps).toEqual([]);
}, 30_000);
