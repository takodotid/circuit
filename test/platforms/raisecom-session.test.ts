// Raisecom read over a real SSH shell, against a fake device that answers like a RAX721: the version check, paging off, and a dump that stalls halfway for longer than the old six seconds of silence, as on a lossy path (#86).

import { afterAll, beforeAll, expect, test } from "bun:test";
import coreSwitch from "../../examples/platforms/raisecom-ros";
import { Platforms } from "../../src/platforms";
import type { Device } from "../../src/schema";
import { FakeSshDevice } from "./fake-ssh";

const platform = Platforms.get("raisecom-ros");
let device: Device;

const fake = new FakeSshDevice(
    "operator",
    (command) => {
        if (command === "show version") return "Raisecom Operating System Software\r\nROS Version 6.5.2\r\n";
        if (command !== "show running-config") return "";

        const config = `!ROS version 6.5.2\r\n!System up time: 3 days\r\n${platform
            .render(device)
            .replace(/<secret:[^>]+>/g, "stored-value")
            .replace(/\n/g, "\r\n")}`;
        const half = Math.floor(config.length / 2);

        return {
            parts: [
                { text: config.slice(0, half), after: 0 },
                { text: config.slice(half), after: 8_000 },
            ],
        };
    },
    {
        banner: "\r\nexample-core-switch#",
        prompt: () => "\r\nexample-core-switch#",
    }
);

beforeAll(async () => {
    process.env.EXAMPLE_OPERATOR_PASSWORD = FakeSshDevice.PASSWORD;
    device = { ...coreSwitch, connection: { host: "127.0.0.1", port: await fake.listen(), user: "operator" } };
});

afterAll(() => fake.close());

test("a read over SSH checks it is ROS, turns paging off, and waits through a stall for the whole dump", async () => {
    const current = await platform.read(device, [device]);

    expect(fake.commands).toEqual(["show version", "terminal page-break disable", "show running-config"]);
    expect(current).not.toContain("System up time");
    // Every line of the dump is kept, with only the version line before the config. A device prints a stored value where the render has a secret marker.
    expect(current.trim().split("\n")).toHaveLength(platform.render(device).trim().split("\n").length + 1);
}, 60_000);
