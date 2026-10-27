// What LLDP saw at the last snapshot, compared with each port's `link`: a cable in another port, a cable missing, and a cable not written down are warnings, and only ports where both ends run LLDP are compared.

import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { Cabling, type Neighbor } from "../../src/core/cabling";
import type { Device } from "../../src/schema";
import sw1 from "../../examples/use-cases/internet-exchange/ix-sw-01";
import sw2 from "../../examples/use-cases/internet-exchange/ix-sw-02";

let root = "";

afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = "";
});

/** Both switches see each other on 40g-5, as their `link` says, spelled the way VRP spells it. */
const agreeing = (): Map<string, Neighbor[]> =>
    new Map([
        ["ix-sw-01", [{ port: "40g-5", system: "ix-sw-02", remote_port: "40GE1/0/5" }]],
        ["ix-sw-02", [{ port: "40g-5", system: "ix-sw-01", remote_port: "40GE1/0/5" }]],
    ]);

const messages = (devices: readonly Device[], neighbors: ReadonlyMap<string, readonly Neighbor[]>) =>
    Cabling.compare(devices, neighbors).map((finding) => `${finding.level} ${finding.device}: ${finding.message}`);

test("cables where LLDP and link agree pass, with a domain after the system name or not", () => {
    expect(messages([sw1, sw2], agreeing())).toEqual([]);

    const withDomain = agreeing();
    withDomain.set("ix-sw-01", [{ port: "40g-5", system: "ix-sw-02.example.net", remote_port: "40GE1/0/5" }]);
    expect(messages([sw1, sw2], withDomain)).toEqual([]);
});

test("a cable in another port than link names is a warning", () => {
    const neighbors = agreeing();
    neighbors.set("ix-sw-01", [{ port: "40g-5", system: "ix-sw-02", remote_port: "40GE1/0/6" }]);

    expect(messages([sw1, sw2], neighbors)).toEqual([
        "warning ix-sw-01: port 40g-5: LLDP sees ix-sw-02 40GE1/0/6, but link names ix-sw-02 40g-5",
    ]);
});

test("a cable link names that LLDP does not see is a warning", () => {
    const neighbors = agreeing();
    neighbors.set("ix-sw-02", []);

    expect(messages([sw1, sw2], neighbors)).toEqual([
        "warning ix-sw-02: port 40g-5: LLDP sees nothing, but link names ix-sw-01 40g-5: the cable is missing or down",
    ]);
});

test("another of our devices on a port without link is a warning, and anything else there is not", () => {
    const neighbors = agreeing();
    neighbors.set("ix-sw-01", [
        ...neighbors.get("ix-sw-01")!,
        { port: "10g-46", system: "ix-sw-02", remote_port: "10GE1/0/46" },
        { port: "10g-47", system: "rs1", remote_port: "eth0" },
    ]);

    expect(messages([sw1, sw2], neighbors)).toEqual(["warning ix-sw-01: port 10g-46: LLDP sees ix-sw-02 10g-46, but the port has no link"]);
});

test("only ports where both ends run LLDP are compared, and only devices whose neighbors were read", () => {
    const quietFarEnd: Device = { ...sw2, ports: { ...sw2.ports, "40g-5": { ...sw2.ports!["40g-5"]!, lldp: false } } };
    const neighbors = agreeing();
    neighbors.set("ix-sw-01", []);

    expect(messages([sw1, quietFarEnd], neighbors)).toEqual([]);
    expect(messages([sw1, sw2], new Map([["ix-sw-02", agreeing().get("ix-sw-02")!]]))).toEqual([]);

    // A member port sends no LLDP, so what it sees is left alone.
    expect(messages([sw1], new Map([["ix-sw-01", [{ port: "40g-1", system: "ix-sw-02", remote_port: "40GE1/0/1" }]]]))).toEqual([]);
});

test("neighbors are saved sorted beside the snapshot, read back, and forgotten", () => {
    root = mkdtempSync(join(tmpdir(), "circuit-cabling-"));
    const neighbors: Neighbor[] = [
        { port: "40g-5", system: "ix-sw-02", remote_port: "40GE1/0/5" },
        { port: "10g-47", system: "rs1", remote_port: "eth0" },
    ];

    Cabling.save(root, "ix-sw-01", neighbors);
    expect(Cabling.path(root, "ix-sw-01")).toBe(join(root, "ix-sw-01.lldp.json"));
    expect(Cabling.load(root, "ix-sw-01")).toEqual([neighbors[1]!, neighbors[0]!]);

    Cabling.forget(root, "ix-sw-01");
    expect(Cabling.load(root, "ix-sw-01")).toBeUndefined();
});

test("validate warns where LLDP disagrees, and diff ignores it", () => {
    root = mkdtempSync(join(tmpdir(), "circuit-cabling-"));
    const example = join(import.meta.dirname, "../../examples/use-cases/internet-exchange/circuit.config.ts").replace(/\\/g, "/");
    writeFileSync(join(root, "circuit.config.ts"), `export { default } from "${example}";\n`);

    mkdirSync(join(root, ".circuit/state"), { recursive: true });
    Cabling.save(join(root, ".circuit/state"), "ix-sw-02", []);

    const cli = join(import.meta.dirname, "../../src/cli/index.ts");
    const run = (...args: string[]) =>
        spawnSync("bun", [cli, ...args, `--config=${join(root, "circuit.config.ts")}`], { encoding: "utf8" });

    const validate = run("validate");
    expect(validate.status).toBe(0);
    expect(validate.stdout).toContain(
        "warn   ix-sw-02: port 40g-5: LLDP sees nothing, but link names ix-sw-01 40g-5: the cable is missing or down"
    );

    expect(run("diff", "ix-sw-02").stdout).not.toContain("LLDP");
});

test("a link through a carrier is not compared with LLDP, which sees the carrier's switches", () => {
    const through = (device: Device): Device => ({
        ...device,
        ports: {
            ...device.ports,
            "40g-5": { ...device.ports!["40g-5"]!, link: { ...device.ports!["40g-5"]!.link!, through: "Carrier local loop" } },
        },
    });
    const neighbors = new Map([
        ["ix-sw-01", [{ port: "40g-5", system: "CARRIER-SW-1", remote_port: "Ethernet1/10" }]],
        ["ix-sw-02", []],
    ]);

    expect(messages([sw1, sw2], neighbors)).toHaveLength(2);
    expect(messages([through(sw1), through(sw2)], neighbors)).toEqual([]);
});

test("a linked port without a description has none: Circuit adds no text the config does not write", () => {
    root = mkdtempSync(join(tmpdir(), "circuit-cabling-"));
    const file = (path: string) => join(import.meta.dirname, "../..", path).replaceAll("\\", "/");
    writeFileSync(
        join(root, "circuit.config.ts"),
        [
            `import network from "${file("examples/use-cases/internet-exchange/circuit.config.ts")}";`,
            `const bare = (device) => device.name !== "ix-sw-01" ? device : { ...device, ports: { ...device.ports, "40g-5": { ...device.ports["40g-5"], description: undefined } } };`,
            `export default { ...network, devices: network.devices.map(bare) };`,
        ].join("\n")
    );

    const build = spawnSync(
        "bun",
        [join(import.meta.dirname, "../../src/cli/index.ts"), "build", "ix-sw-01", `--config=${join(root, "circuit.config.ts")}`],
        {
            encoding: "utf8",
        }
    );

    expect(build.status).toBe(0);
    expect(build.stdout).toContain("interface 40GE1/0/5\n port link-type trunk\n");
});
