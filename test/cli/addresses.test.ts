// `circuit addresses`: every address the project uses, under the space the network owns, and what is free there.

import { expect, test } from "bun:test";
import { join } from "node:path";
import { AddressSpace } from "../../src/core/address-space";
import { readProject } from "../../src/project/project";

const colocation = await readProject(join(import.meta.dir, "..", "..", "examples", "colocation"));
const [network] = colocation.networks;
if (!network) throw new Error("the colocation example has no network");
const devices = Object.values(network.devices);

test("the space the network owns comes from circuit.ts and from what it originates, each with where it came from", () => {
    const report = AddressSpace.report(devices, network.settings.prefixes);
    const [v4, v6] = report.spaces;

    expect(v4?.prefix).toBe("198.51.100.0/24");
    expect(v4?.owner).toBe("prefixes ours.v4 in circuit.ts, originated by edge-01");
    expect(v4?.segments.map((segment) => [segment.prefix, segment.free, segment.next])).toEqual([
        ["198.51.100.8/29", "5", "198.51.100.10"],
    ]);
    expect(v4?.free).toEqual(["198.51.100.0/29", "198.51.100.16/28", "198.51.100.32/27", "198.51.100.64/26", "198.51.100.128/25"]);
    expect(v6?.prefix).toBe("2001:db8:100::/48");
});

test("what is outside the owned space is listed apart, with each use", () => {
    const { elsewhere } = AddressSpace.report(devices, network.settings.prefixes);
    const transit = elsewhere.segments.find((segment) => segment.prefix === "203.0.113.0/30");

    expect(transit?.free).toBe("0");
    expect(transit?.uses).toEqual([
        { address: "203.0.113.1", what: "BGP neighbor hurricane-electric of edge-01" },
        { address: "203.0.113.2", what: "edge-01 transit" },
    ]);
});

test("a prefix asked for is the one space, and free prefixes of one length can be listed", () => {
    const report = AddressSpace.report(devices, network.settings.prefixes, "198.51.100.0/24");
    expect(report.spaces.map((space) => space.owner)).toEqual(["prefixes ours.v4 in circuit.ts, originated by edge-01"]);
    expect(report.elsewhere).toEqual({ segments: [], blocks: [] });

    const asked = AddressSpace.report(devices, {}, "10.9.0.0/16");
    expect(asked.spaces[0]?.owner).toBe("asked for");

    const [space] = report.spaces;
    expect(AddressSpace.text(report, 26)).toContain("  free /26: 198.51.100.64/26, 198.51.100.128/26, 198.51.100.192/26");
    expect(AddressSpace.freeOfLength(space?.free ?? [], 28, 2)).toEqual({ prefixes: ["198.51.100.16/28", "198.51.100.32/28"], total: 15n });
});
