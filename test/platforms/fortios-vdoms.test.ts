// A management VDOM on FortiOS: its interfaces and routes apart from `root`, each section read and sent where it lives, and what is left to an operator refused. The device's answers follow FortiOS 6.2's documented forms; no device has run it yet, so `vdoms` stays refused until one does.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { defineDevice, defineNetwork, secret } from "../../src/core/define";
import { Validator } from "../../src/core/validator";
import { Platforms } from "../../src/platforms";
import { FortiOsVdoms } from "../../src/platforms/fortios/vdoms";
import type { Device } from "../../src/schema";
import { FakeSshDevice } from "./fake-ssh";

const platform = Platforms.get("fortios");
const options = { secrets: false, rollback: 10 };

const firewall = defineDevice({
    name: "fw-01",
    platform: "fortios",
    model: "FG-3700D",
    connection: { host: "127.0.0.1", user: "netops" },
    users: { netops: { role: "admin", password: secret("EXAMPLE_NETOPS_PASSWORD") } },
    management: { allow: ["192.0.2.0/24"], ssh: {}, https: {} },
    ports: {
        "1g-1": { description: "Out-of-band", addresses: ["192.0.2.4/24"] },
        "10g-1": { description: "Upstream", addresses: ["203.0.113.2/30"] },
        "10g-2": { description: "Tenants", addresses: ["198.51.100.1/24"] },
    },
    routing: { static: [{ prefix: "0.0.0.0/0", via: "203.0.113.1", description: "Routed traffic out" }] },
    vdoms: {
        management: {
            name: "mgmt",
            interfaces: ["1g-1"],
            static: [{ prefix: "0.0.0.0/0", via: "192.0.2.1", description: "The firewall's own traffic out" }],
        },
    },
});

const messages = (device: Device) =>
    Validator.run(defineNetwork({ devices: [device] })).map((finding) => `${finding.level} ${finding.device}: ${finding.message}`);

test("a management VDOM is FortiOS only, not root, with its own interfaces and routes, and refused until proved", () => {
    expect(messages(firewall)).toEqual(["error fw-01: fortios cannot express vdoms, a management VDOM is not proved on a device yet"]);

    const wrong = {
        ...firewall,
        vdoms: { management: { name: "root", interfaces: ["1g-1"], static: [{ prefix: "10.0.0.0/8", interface: "10g-1" }] } },
    } as Device;
    expect(messages(wrong)).toContain(
        "error fw-01: vdoms.management.name is root, the VDOM everything else is in; give it a name of its own"
    );
    expect(messages(wrong)).toContain(
        "error fw-01: vdoms.management static route 10.0.0.0/8 leaves through 10g-1, which is not in the VDOM"
    );

    const router = { ...firewall, platform: "routeros", model: "CCR2216-1G-12XS-2XQ" } as Device;
    expect(messages(router)).toContain("error fw-01: vdoms are a FortiOS setting");
});

test("the render puts each interface in its VDOM, and the management VDOM's routes and guards in sections of its own", () => {
    const rendered = platform.render(firewall);

    expect(rendered).toContain('    set vdom-mode multi-vdom\n    set management-vdom "mgmt"\nend');
    expect(rendered).toMatch(/edit "mgmt1"\n {8}set vdom "mgmt"/);
    expect(rendered).toMatch(/edit "port5"\n {8}set vdom "root"/);
    expect(rendered).toContain("config @mgmt router static\n    edit 1\n        set gateway 192.0.2.1");
    expect(rendered).toContain("config @mgmt firewall local-in-policy\n    edit 1");
    // The routed traffic's default route stays in root.
    expect(rendered).toContain("config router static\n    edit 1\n        set gateway 203.0.113.1");
});

test("a plan sends each step in its scope: the device's own settings in global, the rest in its VDOM", () => {
    const desired = platform.render(firewall);
    const current = desired
        .replace("set gateway 192.0.2.1", "set gateway 192.0.2.254")
        .replace('set hostname "fw-01"', 'set hostname "old"');
    const plan = platform.plan(desired, current, options);

    expect(plan.problems).toEqual([]);
    expect(plan.steps.map((step) => step.title)).toEqual(["system global", "mgmt: router static"]);
    expect(plan.steps[0]!.send).toEqual(["config global", "config system global", 'set hostname "fw-01"', "end", "end"]);
    expect(plan.steps[1]!.send).toEqual([
        "config vdom",
        "edit mgmt",
        // A static route is written again whole, as on a device with one VDOM.
        "config router static",
        "delete 1",
        "edit 1",
        "set gateway 192.0.2.1",
        'set device "mgmt1"',
        `set comment "The firewall's own traffic out"`,
        "next",
        "end",
        "next",
        "end",
    ]);
    expect(platform.plan(desired, desired, options).steps).toEqual([]);
});

test("turning multi-VDOM mode on, and moving an interface into another VDOM, are left to an operator", () => {
    const desired = platform.render(firewall);
    const oneVdom = platform.render({ ...firewall, vdoms: undefined } as Device);

    expect(platform.plan(desired, oneVdom, options)).toEqual({
        steps: [],
        problems: [
            "the config has vdoms and the device runs one VDOM. Turn multi-VDOM mode on by hand, on the console: `config system global`, `set vdom-mode multi-vdom`, `end`. It moves everything into root and ends every session",
        ],
    });
    expect(platform.plan(oneVdom, desired, options).problems).toEqual([
        "the device runs several VDOMs and the config has no vdoms. Write vdoms.management, or turn multi-VDOM mode off by hand",
    ]);

    const notMoved = desired.replace(/(edit "mgmt1"\n {8}set vdom )"mgmt"/, '$1"root"');
    expect(platform.plan(desired, notMoved, options).problems).toEqual([
        "mgmt1 from root to mgmt: move an interface into another VDOM by hand, on the console, since it may carry the way in",
    ]);
});

test("tunnels and bridges are refused beside a management VDOM, and so is a route through its interface outside it", () => {
    const device = {
        ...firewall,
        interfaces: { tunnel: { type: "gre", local: "203.0.113.2", remote: "198.51.100.200" } },
        routing: { static: [{ prefix: "10.0.0.0/8", interface: "1g-1" }] },
    } as Device;

    expect(FortiOsVdoms.gaps(device)).toEqual([
        "vdoms with GRE or VXLAN tunnels (tunnel), whose tables belong to a VDOM",
        "routing.static 10.0.0.0/8 leaves through 1g-1, in vdoms.management; write it there",
    ]);
});

/** Where the fake device's shell is: the top, `config global`, `config vdom`, or one VDOM. */
let context = "top";

const fake = new FakeSshDevice(
    "netops",
    (command) => {
        if (command === "get system status")
            return "Version: FortiGate-3700D v6.2.2,build1010,191008 (GA)\r\nVirtual domain configuration: multiple\r\n";
        if (command === "config global") context = "global";
        else if (command === "config vdom") context = "vdom";
        else if (context === "vdom" && command.startsWith("edit ")) context = command.slice(5);
        else if (command === "end") context = "top";
        else if (command === "diagnose sys vd list")
            return "list virtual firewall info:\r\nname=root/root index=0\r\nname=mgmt/mgmt index=1\r\n";

        const section = /^show (?:full-configuration )?(.+)$/.exec(command)?.[1];
        if (!section) return "";

        // The device prints a management VDOM's section under its own name.
        const header = context === "mgmt" ? `config @mgmt ${section}` : `config ${section}`;
        const lines = platform.render(firewall).split("\n");
        const start = lines.indexOf(header);
        if (start < 0) return "";
        const end = lines.indexOf("end", start);
        return [`config ${section}`, ...lines.slice(start + 1, end + 1)].join("\r\n") + "\r\n";
    },
    { banner: "fw-01 # ", prompt: () => (context === "top" ? "fw-01 # " : `fw-01 (${context}) # `) }
);

let device: Device;

beforeAll(async () => {
    process.env.EXAMPLE_NETOPS_PASSWORD = FakeSshDevice.PASSWORD;
    device = { ...firewall, connection: { host: "127.0.0.1", port: await fake.listen(), user: "netops" } } as Device;
});

afterAll(() => fake.close());

test("a read of a multi-VDOM device shows each section where it lives, and plans nothing against the render", async () => {
    const current = await platform.read(device, [device]);
    const order = fake.commands.filter((command) => !command.startsWith("show "));

    expect(order).toEqual([
        "get system status",
        "config global",
        "diagnose sys vd list",
        "end",
        "config vdom",
        "edit root",
        "end",
        "config vdom",
        "edit mgmt",
        "end",
    ]);
    expect(fake.commands).toContain("show system interface");
    expect(current).toContain("config @mgmt router static");
    expect(platform.plan(platform.render(firewall), current, options).steps).toEqual([]);
}, 60_000);
