// Raisecom read over a real SSH shell, against a fake device that answers like a RAX721: the version check, paging off, and a dump that stops short the first time, so it is read again.

import { afterAll, beforeAll, expect, test } from "bun:test";
import coreSwitch from "../../examples/platforms/raisecom-ros";
import { Platforms } from "../../src/platforms";
import type { Device } from "../../src/schema";
import { FakeSshDevice } from "./fake-ssh";

const platform = Platforms.get("raisecom-ros");
let device: Device;
let dumps = 0;

const fake = new FakeSshDevice(
    "operator",
    (command) => {
        if (command === "show version") return "Raisecom Operating System Software\r\nROS Version 6.5.2\r\n";
        if (command !== "show running-config") return "";

        dumps++;
        const config = `!ROS version 6.5.2\r\n!System up time: ${dumps} days\r\n${platform
            .render(device)
            .replace(/<secret:[^>]+>/g, "stored-value")
            .replace(/\n/g, "\r\n")}`;

        // The first dump stops halfway, with no prompt after it.
        return dumps === 1 ? config.slice(0, config.length / 2) : config;
    },
    {
        banner: "\r\nexample-core-switch#",
        // The prompt is left out after the first dump only, as on a device that stopped short.
        prompt: () => (dumps === 1 && fake.commands.at(-1) === "show running-config" ? "" : "\r\nexample-core-switch#"),
    }
);

beforeAll(async () => {
    process.env.EXAMPLE_OPERATOR_PASSWORD = FakeSshDevice.PASSWORD;
    device = { ...coreSwitch, connection: { host: "127.0.0.1", port: await fake.listen(), user: "operator" } };
});

afterAll(() => fake.close());

test("a read over SSH checks it is ROS, turns paging off, and reads a cut dump again", async () => {
    const current = await platform.read(device, [device]);

    expect(fake.commands).toEqual(["show version", "terminal page-break disable", "show running-config", "", "show running-config"]);
    expect(current).not.toContain("System up time");
    // Every line of the second, whole dump is kept, with only the version line before the config. A device prints a stored value where the render has a secret marker.
    expect(current.trim().split("\n")).toHaveLength(platform.render(device).trim().split("\n").length + 1);
}, 60_000);
