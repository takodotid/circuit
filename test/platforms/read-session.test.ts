// The session `circuit show` runs commands in, over a real SSH session against fake devices: RouterOS runs each command on its own with plain wide output, VRP runs them in one shell after its login questions, and FortiOS moves to one shell once a session filter must carry over.

import { afterAll, beforeAll, expect, test } from "bun:test";
import firewall from "../../examples/platforms/fortios";
import switchDevice from "../../examples/platforms/vrp";
import { Platforms } from "../../src/platforms";
import type { Device } from "../../src/schema";
import router from "../../templates/single-site/router";
import { FakeSshDevice } from "./fake-ssh";

const routerOs = new FakeSshDevice("operator+ct300w", (command) =>
    command === "/ip route print count-only" ? "12\n" : `bad command name ${command}\n`
);

const vrp = new FakeSshDevice(
    "operator",
    (command) => (command === "display version" ? "Huawei Versatile Routing Platform Software\r\nVRP (R) software, Version 8.150" : ""),
    {
        banner: "Info: The password has not been changed for a long time.\r\nChange now? [Y/N]:",
        prompt: () => "\r\n<example-switch>",
    }
);

const fortiOs = new FakeSshDevice(
    "netops",
    (command) => {
        if (command === "get system status") return "Version: FortiGate-3700D v6.2.2,build1010,191008 (GA)\r\n";
        if (command === "diagnose sys session list") return "session info: proto=6 proto_state=01\r\ntotal session 1\r\n";
        return "";
    },
    {
        banner: "example-firewall # ",
        prompt: () => "example-firewall # ",
    }
);

/** A device of the fake's, at its port on this computer. */
async function at(device: Device, fake: FakeSshDevice, user: string): Promise<Device> {
    return { ...device, connection: { host: "127.0.0.1", port: await fake.listen(), user } };
}

let devices: { router: Device; switch: Device; firewall: Device };

beforeAll(async () => {
    process.env.ROUTER_PASSWORD = FakeSshDevice.PASSWORD;
    process.env.EXAMPLE_OPERATOR_PASSWORD = FakeSshDevice.PASSWORD;
    process.env.EXAMPLE_NETOPS_PASSWORD = FakeSshDevice.PASSWORD;

    devices = {
        router: await at(router, routerOs, "operator"),
        switch: await at(switchDevice, vrp, "operator"),
        firewall: await at(firewall, fortiOs, "netops"),
    };
});

afterAll(() => {
    for (const fake of [routerOs, vrp, fortiOs]) fake.close();
});

test("RouterOS logs in for plain wide output and runs each command on its own", async () => {
    const session = await Platforms.get("routeros").session(devices.router);

    try {
        expect(await session.run("/ip route print count-only")).toBe("12");
        expect(routerOs.shellLines).toEqual([]);
    } finally {
        session.close();
    }
});

test("VRP answers no to a new password, turns paging off, and returns each answer without its echo or the prompt", async () => {
    const session = await Platforms.get("vrp").session(devices.switch);

    try {
        expect(await session.run("display version")).toBe("Huawei Versatile Routing Platform Software\nVRP (R) software, Version 8.150");
        expect(vrp.commands).toEqual(["N", "screen-length 0 temporary", "display version"]);
    } finally {
        session.close();
    }
}, 30_000);

test("FortiOS runs a command on its own until a session filter is set, then the filter and the rest in one shell", async () => {
    const session = await Platforms.get("fortios").session(devices.firewall);

    try {
        expect(await session.run("get system status")).toContain("v6.2.2");
        expect(await session.run("diagnose sys session filter dst 192.0.2.1")).toBe("");
        expect(await session.run("diagnose sys session list")).toBe("session info: proto=6 proto_state=01\ntotal session 1");

        expect(fortiOs.commands).toEqual(["get system status", "diagnose sys session filter dst 192.0.2.1", "diagnose sys session list"]);
        expect(fortiOs.shellLines).toEqual(["diagnose sys session filter dst 192.0.2.1", "diagnose sys session list"]);
    } finally {
        session.close();
    }
}, 30_000);
