import { afterAll, expect, test } from "bun:test";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AddressSpace } from "../../src/core/address-space";
import { Project } from "../../src/project";

const colocation = await Project.read(join(import.meta.dir, "..", "..", "examples", "colocation"));
const [network] = colocation.networks;
if (!network) throw new Error("the colocation example has no network");
const devices = Object.values(network.devices);

test("the space the network owns comes from circuit.ts and from what it originates, each with where it came from", () => {
    const report = AddressSpace.report(devices, network.settings.prefixes);
    const [tenant, v4, v6] = report.spaces;

    // The tenant's private network, which edge-01 announces in the tenant's VRF.
    expect(tenant?.prefix).toBe("10.20.0.0/24");
    expect(tenant?.owner).toBe("originated by edge-01");
    expect(v4?.prefix).toBe("198.51.100.0/24");
    expect(v4?.owner).toBe("prefixes ours.v4 in circuit.ts, originated by edge-01");
    expect(v4?.segments.map((segment) => [segment.prefix, segment.free, segment.next])).toEqual([
        ["198.51.100.8/29", "5", "198.51.100.10"],
        ["198.51.100.64/27", "4", "198.51.100.66"],
        // hall-2's link to Aluxis, with no address left.
        ["198.51.100.248/30", "0", undefined],
    ]);
    expect(v4?.free).toEqual([
        "198.51.100.0/29",
        "198.51.100.16/28",
        "198.51.100.32/27",
        "198.51.100.96/27",
        "198.51.100.128/26",
        "198.51.100.192/27",
        "198.51.100.224/28",
        "198.51.100.240/29",
        "198.51.100.252/30",
    ]);
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
    expect(AddressSpace.text(report, 26)).toContain("  free /26: 198.51.100.128/26\n");
    expect(AddressSpace.freeOfLength(space?.free ?? [], 28, 2)).toEqual({ prefixes: ["198.51.100.16/28", "198.51.100.32/28"], total: 12n });
});

// A copy: a project is read once for each folder in a process, and another test reads the example itself.
const scratch = mkdtempSync(join(tmpdir(), "circuit-address-space-"));
cpSync(join(import.meta.dir, "..", "..", "examples", "edge-router"), scratch, { recursive: true });
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
const edgeRouter = await Project.read(scratch);
const [access] = edgeRouter.networks;
if (!access) throw new Error("the edge-router example has no network");

test("a NAT pool and its subscribers, and a PPPoE server's pools, are address space in use, each with its device", () => {
    const report = AddressSpace.report(Object.values(access.devices), access.settings.prefixes);
    const ours = report.spaces.find((space) => space.prefix === "198.51.100.0/24");

    // The pool is inside the space the network owns, so it is not free.
    expect(ours?.blocks).toContainEqual({ prefix: "198.51.100.0/27", what: "NAT pool for 100.64.0.0/22 on edge-01" });
    expect(ours?.free).not.toContain("198.51.100.0/27");
    expect(ours?.free).toContain("198.51.100.32/27");

    // The subscribers' shared space is outside it. A PPPoE pool is a range, placed by the prefix that holds it.
    expect(report.elsewhere.blocks).toContainEqual({ prefix: "100.64.0.0/22", what: "subscribers of NAT pool 198.51.100.0/27 on edge-01" });
    expect(report.elsewhere.blocks).toContainEqual({
        prefix: "100.64.0.0/18",
        range: "100.64.0.2-100.64.63.254",
        what: "PPPoE pool olt-1 on bng-01",
    });
    expect(report.elsewhere.blocks).toContainEqual({ prefix: "100.64.0.1/32", what: "PPPoE server olt-1 on bng-01" });

    // The prefixes it delegates are in the IPv6 space the network owns.
    const ours6 = report.spaces.find((space) => space.prefix === "2001:db8:100::/48");
    expect(ours6?.blocks).toContainEqual({ prefix: "2001:db8:100:4000::/50", what: "prefixes delegated by PPPoE server olt-1 on bng-01" });
    expect(ours6?.free).not.toContain("2001:db8:100:4000::/50");
});

test("the text prints a pool as its range, and asking for the pool's prefix shows what uses it", () => {
    const text = AddressSpace.text(AddressSpace.report(Object.values(access.devices), access.settings.prefixes));
    expect(text).toContain("  100.64.0.2-100.64.63.254  PPPoE pool olt-1 on bng-01");

    const asked = AddressSpace.report(Object.values(access.devices), access.settings.prefixes, "100.64.0.0/18");
    expect(asked.spaces[0]?.blocks.map((block) => block.what)).toEqual([
        "PPPoE pool olt-1 on bng-01",
        "subscribers of NAT pool 198.51.100.0/27 on edge-01",
        "PPPoE server olt-1 on bng-01",
    ]);
});
