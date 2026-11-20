// Raisecom over a real SSH shell, against fake devices that answer like a RAX721. A read's dump stalls halfway for 8 seconds, as on a lossy path (#86).

import { afterAll, beforeAll, expect, test } from "bun:test";
import type { Device } from "../../src/model";
import { Platforms } from "../../src/platforms";
import { Fixtures } from "../fixtures";
import { FakeSshDevice } from "./fake-ssh";

const coreSwitch = Fixtures.device("platforms--example-core-switch");
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
                { text: config.slice(half), after: 8000 },
            ],
        };
    },
    {
        banner: "\r\nexample-core-switch#",
        prompt: () => "\r\nexample-core-switch#",
    }
);

/** Answers a rate above a 10G port's speed as tako-mmr-01 did, with no `Error`, and takes every other line in silence. */
const tooFast = new FakeSshDevice(
    "operator",
    (command) => {
        if (command === "show version") return "Raisecom Operating System Software\r\nROS Version 6.5.2\r\n";
        return command.startsWith("rate-limit egress cir 100000000") ? "Exceed the actual bandwidth of the interface.\r\n" : "";
    },
    {
        banner: "\r\nexample-core-switch#",
        prompt: () => "\r\nexample-core-switch(config)#",
    }
);
let tooFastPort = 0;

beforeAll(async () => {
    process.env.EXAMPLE_OPERATOR_PASSWORD = FakeSshDevice.PASSWORD;
    device = { ...coreSwitch, connection: { host: "127.0.0.1", port: await fake.listen(), user: "operator" } };
    tooFastPort = await tooFast.listen();
});

afterAll(() => {
    delete process.env.EXAMPLE_OPERATOR_PASSWORD;
    fake.close();
    tooFast.close();
});

test("a read over SSH checks it is ROS, turns paging off, and waits through a stall for the whole dump", async () => {
    const current = await platform.read(device, [device]);

    expect(fake.commands).toEqual(["show version", "terminal page-break disable", "show running-config"]);
    expect(current).not.toContain("System up time");
    // Every line of the dump is kept, and only the version line comes before the config.
    expect(current.trim().split("\n")).toHaveLength(platform.render(device).trim().split("\n").length + 1);
}, 60_000);

test("a rate the port can't carry stops the apply, though the switch's answer has no error word", async () => {
    const target: Device = { ...coreSwitch, connection: { host: "127.0.0.1", port: tooFastPort, user: "operator" } };
    const send = ["interface tengigabitethernet 1/3/12", "rate-limit egress cir 100000000", "exit"];
    const plan = { steps: [{ title: "interface tengigabitethernet 1/3/12", show: [], send }], problems: [] };

    await expect(platform.apply(target, [target], plan, { secrets: false, rollback: 0 })).rejects.toThrow(
        "Exceed the actual bandwidth of the interface."
    );
}, 60_000);
