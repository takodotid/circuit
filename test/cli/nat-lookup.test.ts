import { expect, test } from "bun:test";
import { join } from "node:path";
import { Derive } from "../../src/core/derive";
import { NatLookup } from "../../src/core/nat-lookup";
import type { Device, PoolNatRule } from "../../src/model";
import { Project } from "../../src/project";

const example = await Project.read(join(import.meta.dir, "..", "..", "examples", "edge-router"));
const devices = example.networks.flatMap((network) => Object.values(network.devices));
const edge = devices.find((device) => device.name === "edge-01");
if (!edge) throw new Error("the edge-router example has no edge-01");

const rule = edge.firewall?.nat?.source?.find((each): each is PoolNatRule => "to_pool" in each);
if (!rule) throw new Error("edge-01 has no CGNAT rule");

const text = (address: string, port?: number) => {
    const found = NatLookup.find(devices, address, port);
    return NatLookup.text(found.answers, address, port).trimEnd();
};

test("a pool address and a port name the subscriber whose block holds the port", () => {
    expect(text("198.51.100.7", 40000)).toBe("edge-01: 198.51.100.7:40000 is 100.64.0.243 (to_pool 198.51.100.0/27, ports 39328-41343)");
});

test("a subscriber's address names its pool address and ports", () => {
    expect(text("100.64.0.243")).toBe("edge-01: 100.64.0.243 leaves as 198.51.100.7, ports 39328-41343 (to_pool 198.51.100.0/27)");
});

test("both directions agree with the mapping the platforms write, for every subscriber", () => {
    for (const each of Derive.poolAddresses(rule)) {
        for (const { subscriber, ports } of each.blocks) {
            const [answer] = NatLookup.find(devices, subscriber).answers;
            expect([answer?.pool_address, answer?.ports]).toEqual([each.address, ports]);

            for (const port of [ports.min, ports.max]) {
                const [back] = NatLookup.find(devices, each.address, port).answers;
                expect([back?.subscriber, back?.ports]).toEqual([subscriber, ports]);
            }
        }
    }
});

test("a pool address alone lists every subscriber that shares it, and text cuts a long list", () => {
    const [answer] = NatLookup.find(devices, "198.51.100.0").answers;
    expect(answer?.subscribers?.length).toBe(32);
    expect(answer?.subscribers?.[0]).toEqual({ subscriber: "100.64.0.0", ports: { min: 1024, max: 3039 } });

    const lines = NatLookup.text(NatLookup.find(devices, "198.51.100.0").answers, "198.51.100.0", undefined, 2).split("\n");
    expect(lines[0]).toBe("edge-01: 198.51.100.0 is shared by 32 subscribers (to_pool 198.51.100.0/27, port_set_size 2016)");
    expect(lines[2]).toBe("    100.64.0.1  ports 3040-5055");
    expect(lines[3]).toBe("    and 30 more. Give a port to find one, or use --format json for all.");
});

test("a port below 1024 is in no block, and a subscriber's address takes no port", () => {
    expect(NatLookup.find(devices, "198.51.100.7", 80).notes).toEqual([
        "edge-01: 198.51.100.7 is in to_pool 198.51.100.0/27, but port 80 is below 1024, so no block holds it. The blocks run from 1024 to 65535.",
    ]);
    expect(NatLookup.find(devices, "100.64.0.243", 40000).notes).toEqual([
        "edge-01: 100.64.0.243 is a subscriber of 100.64.0.0/22, not a pool address. Leave the port out.",
    ]);
});

test("ports after the last block are in no block", () => {
    const small: Device = {
        ...edge,
        firewall: { ...edge.firewall, nat: { source: [{ ...rule, port_set_size: 1000 }] } },
    };

    expect(NatLookup.find([small], "198.51.100.7", 30000).answers.length).toBe(1);
    expect(NatLookup.find([small], "198.51.100.7", 40000).notes).toEqual([
        "edge-01: 198.51.100.7 is in to_pool 198.51.100.0/27, but port 40000 is past the last block. The blocks run from 1024 to 33023.",
    ]);
});

test("an address in no pool finds nothing, and the pools are listed", () => {
    const found = NatLookup.find(devices, "203.0.113.9");
    expect(found.answers).toEqual([]);
    expect(found.notes).toEqual([]);
    expect(found.pools).toEqual(["edge-01: to_pool 198.51.100.0/27 for 100.64.0.0/22"]);
});

test("a rule validate refuses is not answered from", () => {
    const wide: Device = {
        ...edge,
        firewall: { ...edge.firewall, nat: { source: [{ ...rule, port_set_size: 4000 }] } },
    };

    expect(NatLookup.find([wide], "198.51.100.7", 40000).pools).toEqual([]);
});
