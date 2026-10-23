// FortiOS read over a real SSH shell, against a fake device that answers like a FortiGate 3700D: the version check, then `show` for each section Circuit manages.

import { afterAll, beforeAll, expect, test } from "bun:test";
import firewall from "../../examples/firewall";
import { Platforms } from "../../src/platforms";
import { FortiOsRender } from "../../src/platforms/fortios/render";
import type { Device } from "../../src/schema";
import { FakeSshDevice } from "./fake-ssh";

const platform = Platforms.get("fortios");
let device: Device;
let version = "v6.2.2,build1010,191008 (GA)";

/** One top-level `config` block of the render, as `show` prints it, or nothing when the render has none. */
function shown(section: string): string {
    const lines = platform.render(device).split("\n");
    const start = lines.indexOf(`config ${section}`);
    if (start < 0) return "";

    const end = lines.indexOf("end", start);
    return `${lines.slice(start, end + 1).join("\r\n")}\r\n`;
}

const fake = new FakeSshDevice(
    "netops",
    (command) => {
        if (command === "get system status") return `Version: FortiGate-3700D ${version}\r\nHostname: example-firewall\r\n`;

        const section = /^show (?:full-configuration )?(.+)$/.exec(command)?.[1];
        return section ? shown(section) : "";
    },
    {
        banner: "example-firewall # ",
        prompt: () => "example-firewall # ",
    }
);

beforeAll(async () => {
    process.env.EXAMPLE_NETOPS_PASSWORD = FakeSshDevice.PASSWORD;
    device = { ...firewall, connection: { host: "127.0.0.1", port: await fake.listen(), user: "netops" } };
});

afterAll(() => fake.close());

test("a read over SSH checks the version, then shows each section Circuit manages", async () => {
    const current = await platform.read(device, [device]);

    const shows = FortiOsRender.SECTIONS.map(
        (section) => `${FortiOsRender.FULL.includes(section) ? "show full-configuration" : "show"} ${section}`
    );
    expect(fake.commands).toEqual(["get system status", ...shows]);
    expect(current).toContain("config system global");
}, 60_000);

test("a device on another release is refused before anything is shown", async () => {
    version = "v7.0.12,build0523,230707 (GA.M)";
    const count = fake.commands.length;

    await expect(platform.read(device, [device])).rejects.toThrow("runs FortiOS 7.0.12; this adapter renders for FortiOS 6.2");
    expect(fake.commands.slice(count)).toEqual(["get system status"]);

    version = "v6.2.2,build1010,191008 (GA)";
});
