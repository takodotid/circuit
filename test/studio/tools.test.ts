// Studio's tools read the config as the schema describes it: where an address is, the VLAN path between two devices, which firewall rule a packet meets, and what a route policy does to a route.

import { expect, test } from "bun:test";
import { Platforms } from "../../src/platforms";
import { Topology } from "../../src/core/topology";
import { StudioModel } from "../../src/studio/data";
import { Evaluate } from "../../src/studio/public/evaluate.js";
import router from "../../examples/router";

const network = (await import("../../templates/colocation/circuit.config.ts")).default;
const data = StudioModel.build(
    network.devices,
    { ...Topology.of(network.devices), findings: [], drift: {} },
    {
        render: (device) => Platforms.get(device.platform).render(device),
        snapshot: () => undefined,
        files: () => ({}),
    }
);

test("trace finds who holds an address, its segment, how each device reaches it, and the rules that name it", () => {
    const found = Evaluate.trace(data, "10.0.99.2")!;

    expect(found.held).toEqual([{ device: "tor-01", where: "mgmt", address: "10.0.99.2/24" }]);
    expect(found.segment?.prefix).toBe("10.0.99.0/24");
    expect(found.uses.map((use) => use.what)).toEqual(["tor-01 mgmt"]);

    expect(found.routes.find((route) => route.device === "edge-01")).toMatchObject({
        kind: "connected",
        prefix: "10.0.99.0/24",
        through: "mgmt",
    });
    expect(found.routes.find((route) => route.device === "tor-01")).toMatchObject({ kind: "local", through: "mgmt" });

    const outside = Evaluate.trace(data, "8.8.8.8")!;
    expect(outside.routes.find((route) => route.device === "tor-01")).toMatchObject({
        kind: "static",
        prefix: "0.0.0.0/0",
        via: "10.0.99.1",
    });

    expect(Evaluate.trace(data, "not an address")).toBeUndefined();
});

test("vlanPath walks the cables that carry a VLAN", () => {
    const path = Evaluate.vlanPath(data, 99, "edge-01", "tor-01")!;
    expect(path.map((cable) => `${cable.from} ${cable.to}`)).toEqual(["device:edge-01 device:tor-01"]);
    expect(Evaluate.vlanPath(data, 4000, "edge-01", "tor-01")).toBeUndefined();
});

test("a packet meets the first rule that matches, or the chain's default", () => {
    const bgp = Evaluate.filterPacket(router, "input", {
        protocol: "tcp",
        src: "203.0.113.1",
        dst: "192.0.2.1",
        dstPort: 179,
        state: "new",
    });
    expect([bgp.verdict, bgp.by]).toEqual(["accept", "rule 3"]);
    expect(bgp.steps[1]?.check.why).toEqual(["its source is in the set management"]);

    const stranger = Evaluate.filterPacket(router, "input", {
        protocol: "tcp",
        src: "198.51.100.200",
        dst: "192.0.2.1",
        dstPort: 22,
        state: "new",
    });
    expect([stranger.verdict, stranger.by]).toEqual(["drop", "the chain's default"]);

    const forwarded = Evaluate.filterPacket(router, "forward", {
        protocol: "udp",
        src: "10.0.0.1",
        dst: "10.0.0.2",
        dstPort: 53,
        state: "new",
    });
    expect(forwarded.verdict).toBe("accept");
    expect(forwarded.by).toContain("accept when none is written");

    const unsure = Evaluate.filterPacket(router, "input", { protocol: "tcp", dst: "192.0.2.1", dstPort: 179, state: "new" });
    expect([unsure.verdict, unsure.by]).toEqual([undefined, "rule 2"]);
    expect(unsure.steps[1]?.check).toEqual({ answer: "unknown", why: ["the source address"] });
});

test("a route goes through a policy's rules in order, changed by each it matches", () => {
    const route = { communities: [], largeCommunities: [], inRegistrySets: [] };

    const defaultRoute = Evaluate.routeThrough(router, "UPSTREAM-IN", { ...route, prefix: "0.0.0.0/0" });
    expect(defaultRoute.decision).toBe("accept");
    expect(defaultRoute.attributes).toMatchObject({ localPref: 200, preferredSource: "192.0.2.255", largeCommunities: ["64500:1:1"] });

    const ours = Evaluate.routeThrough(router, "UPSTREAM-OUT", {
        ...route,
        prefix: "198.51.100.0/24",
        rpki: "valid",
        largeCommunities: ["64500:2:9", "65000:1:1"],
    });
    expect(ours.decision).toBe("accept");
    expect(ours.attributes).toMatchObject({ communities: ["64501:100"], largeCommunities: ["65000:1:1"], prepend: 1, med: 10 });

    const blocked = Evaluate.routeThrough(router, "UPSTREAM-OUT", {
        ...route,
        prefix: "198.51.100.0/24",
        largeCommunities: ["64500:100:0"],
    });
    expect([blocked.decision, blocked.steps.length]).toEqual(["reject", 1]);

    const unmatched = Evaluate.routeThrough(router, "UPSTREAM-IN", { ...route, prefix: "203.0.113.0/24", asPathLength: 5 });
    expect([unmatched.decision, unmatched.byDefault]).toEqual(["reject", true]);

    const unsure = Evaluate.routeThrough(router, "UPSTREAM-IN", { ...route, prefix: "203.0.113.0/24" });
    expect(unsure.decision).toBe("unknown");
});
