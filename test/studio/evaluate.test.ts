// Studio's two tests, on devices written here: a packet through a filter chain, and a route through a route policy.

import { describe, expect, test } from "bun:test";
import type { Device } from "../../src/model";
import { Evaluate, type Route } from "../../src/studio/app/src/lib/evaluate";

const base = {
    site: "dc-1",
    platform: "routeros",
    model: "CCR2216-1G-12XS-2XQ",
    connection: { host: "192.0.2.254", user: "operator" },
};

const router = {
    ...base,
    name: "edge-01",
    firewall: {
        address_sets: { management: ["198.51.100.0/24"], v6: ["2001:db8::/32"] },
        filter: {
            input: {
                default_action: "drop",
                rules: [
                    { description: "Replies", if: { connection_state: ["established", "related"] }, then: "accept" },
                    { description: "Ping", if: { protocol: "icmp" }, then: "accept" },
                    { description: "Management", if: { src_address_set: "management", protocol: "tcp", dst_port: 22 }, then: "accept" },
                    { description: "BGP", if: { src: "203.0.113.1", protocol: "tcp", dst_port: 179 }, then: "accept" },
                ],
            },
            forward: {
                rules: [
                    { if: { protocol: "tcp", tcp_flags: { set: ["fin", "syn"] } }, then: "drop" },
                    { if: { in_interface: "25g-1", dst: "192.0.2.0/24", dst_port: { min: 80, max: 443 } }, then: "reject" },
                ],
            },
        },
    },
    routing: {
        prefix_sets: {
            ours: { prefixes: ["192.0.2.0/24", "2001:db8::/32"] },
            customer: { source: { registry: "ripe-stat", query: "AS64501", family: "ipv4" } },
        },
        policies: {
            sanity: [
                { description: "IPv4 longer than /24", if: { family: "ipv4", prefix_length: { min: 25 } }, then: "reject" },
                { description: "RPKI invalid", if: { rpki: "invalid" }, then: "reject" },
            ],
            tag: [{ set: { add_standard_communities: ["64500:100"] } }],
            "transit-import": [
                { call: "sanity" },
                { call: "tag" },
                { if: { prefix_set: "ours" }, then: "reject" },
                { if: { standard_community: "64500:100", as_path_length: { max: 3 } }, set: { local_pref: 200 }, then: "accept" },
                { set: { local_pref: 100, remove_standard_communities: ["64500:*"] } },
            ],
            "customer-import": [{ if: { prefix_set: "customer" }, then: "accept" }],
            loop: [{ call: "loop" }, { then: "accept" }],
        },
    },
} as unknown as Device;

const route = (prefix: string, more: Partial<Route> = {}): Route => ({
    prefix,
    communities: [],
    largeCommunities: [],
    inRegistrySets: [],
    ...more,
});

describe("a packet through a filter chain", () => {
    test("the first rule that matches decides", () => {
        const result = Evaluate.firewall(router, "input", { protocol: "icmp", src: "203.0.113.9", state: "established" });
        expect(result.verdict).toBe("accept");
        expect(result.by).toBe("rule 1");
        expect(result.steps).toHaveLength(1);
    });

    test("a rule that does not match says why, and the next one is tried", () => {
        const result = Evaluate.firewall(router, "input", {
            protocol: "tcp",
            src: "198.51.100.7",
            dst: "192.0.2.10",
            dstPort: 22,
            state: "new",
        });
        expect(result.verdict).toBe("accept");
        expect(result.by).toBe("rule 3");
        expect(result.steps[0]!.check).toEqual({ answer: "no", why: ["it is for established or related packets"] });
        expect(result.steps[1]!.check.why).toEqual(["it is for icmp"]);
    });

    test("no rule matches: the chain's default_action decides", () => {
        const result = Evaluate.firewall(router, "input", { protocol: "udp", src: "198.51.100.7", dstPort: 53, state: "new" });
        expect(result.verdict).toBe("drop");
        expect(result.by).toBe("the chain's default_action");
        expect(result.steps).toHaveLength(4);
    });

    test("a chain with no default_action accepts", () => {
        const result = Evaluate.firewall(router, "forward", {
            protocol: "udp",
            src: "198.51.100.7",
            dst: "203.0.113.5",
            inInterface: "1g-1",
        });
        expect(result.verdict).toBe("accept");
        expect(result.by).toContain("no default_action");
    });

    test("a device with no such chain accepts everything", () => {
        expect(Evaluate.firewall(router, "output", { protocol: "tcp" }).verdict).toBe("accept");
    });

    test("a rule that needs a value left empty stops there and says what it needs", () => {
        const result = Evaluate.firewall(router, "input", { protocol: "tcp", src: "198.51.100.7" });
        expect(result.verdict).toBeUndefined();
        expect(result.by).toBe("rule 1");
        expect(result.needs).toEqual(["the connection state"]);
    });

    test("a condition that fails decides even beside one not known", () => {
        // Rule 3 wants TCP to port 22: the port is not given, but the packet is UDP, so the rule cannot match anyway.
        const result = Evaluate.firewall(router, "input", { protocol: "udp", src: "198.51.100.7", state: "new" });
        expect(result.steps[2]!.check.answer).toBe("no");
        expect(result.verdict).toBe("drop");
    });

    test("TCP flags, ports in a range, and the interface it arrives on", () => {
        const flags = Evaluate.firewall(router, "forward", { protocol: "tcp", flags: ["fin", "syn"] });
        expect(flags.verdict).toBe("drop");

        const range = Evaluate.firewall(router, "forward", {
            protocol: "tcp",
            flags: ["syn"],
            inInterface: "25g-1",
            dst: "192.0.2.80",
            dstPort: 443,
        });
        expect(range.verdict).toBe("reject");
        expect(range.by).toBe("rule 2");

        const elsewhere = Evaluate.firewall(router, "forward", {
            protocol: "tcp",
            flags: ["syn"],
            inInterface: "25g-2",
            dst: "192.0.2.80",
            dstPort: 443,
        });
        expect(elsewhere.steps[1]!.check.why).toEqual(["it is for packets arriving on 25g-1"]);
    });

    test("a rule with addresses of one family does not match the other family", () => {
        const result = Evaluate.firewall(router, "input", { family: "ipv6", protocol: "tcp", state: "new", dstPort: 179 });
        expect(result.steps[3]!.check).toEqual({ answer: "no", why: ["its addresses are ipv4"] });
    });
});

describe("a route through a route policy", () => {
    test("a called policy that rejects decides", () => {
        const result = Evaluate.policy(router, "transit-import", route("198.51.100.128/25", { rpki: "valid" }));
        expect(result.decision).toBe("reject");
        expect(result.by).toBe("rule 1 of sanity");
        expect(result.steps.map((step) => [step.policy, step.depth])).toEqual([
            ["transit-import", 0],
            ["sanity", 1],
        ]);
    });

    test("a called policy that decides nothing goes on, with what it set", () => {
        const result = Evaluate.policy(router, "transit-import", route("198.51.100.0/24", { rpki: "valid", asPath: [6939, 64501] }));
        expect(result.decision).toBe("accept");
        expect(result.by).toBe("rule 4 of transit-import");
        expect(result.attributes.localPref).toBe(200);
        expect(result.attributes.communities).toEqual(["64500:100"]);
        expect(result.steps.find((step) => step.policy === "tag")!.changed).toEqual(["communities added: 64500:100"]);
    });

    test("a prefix set holds a route that is one of its prefixes, or inside one", () => {
        const result = Evaluate.policy(router, "transit-import", route("192.0.2.0/24", { rpki: "not-found" }));
        expect(result.decision).toBe("reject");
        expect(result.by).toBe("rule 3 of transit-import");

        const inside = Evaluate.policy(router, "transit-import", route("2001:db8:100::/48", { rpki: "valid" }));
        expect(inside.by).toBe("rule 3 of transit-import");
    });

    test("a route no rule accepts is rejected", () => {
        const result = Evaluate.policy(
            router,
            "transit-import",
            route("198.51.100.0/24", { rpki: "valid", asPath: [6939, 174, 3356, 64501] })
        );
        expect(result.decision).toBe("reject");
        expect(result.by).toContain("no rule accepted it");
        // The last rule still changed it: local_pref, and our communities taken off.
        expect(result.attributes.localPref).toBe(100);
        expect(result.attributes.communities).toEqual([]);
    });

    test("a rule that needs a value left empty stops there and says what it needs", () => {
        const result = Evaluate.policy(router, "transit-import", route("198.51.100.0/24"));
        expect(result.decision).toBeUndefined();
        expect(result.by).toBe("rule 2 of sanity");
        expect(result.needs).toEqual(["the RPKI state"]);

        const path = Evaluate.policy(router, "transit-import", route("198.51.100.0/24", { rpki: "valid" }));
        expect(path.needs).toEqual(["the AS path"]);
    });

    test("a prefix set from a registry holds the route only when ticked", () => {
        expect(Evaluate.policy(router, "customer-import", route("198.51.100.0/24")).decision).toBe("reject");
        expect(Evaluate.policy(router, "customer-import", route("198.51.100.0/24", { inRegistrySets: ["customer"] })).decision).toBe(
            "accept"
        );
    });

    test("a policy that calls itself is not followed again", () => {
        const result = Evaluate.policy(router, "loop", route("198.51.100.0/24"));
        expect(result.decision).toBe("accept");
        expect(result.steps[0]!.note).toContain("not followed again");
    });

    test("the policies a device has, the ones its sessions use first", () => {
        const data = {
            sessions: [{ device: "edge-01", name: "he", address: "203.0.113.1", import: "transit-import", export: "customer-import" }],
        } as never;
        const listed = Evaluate.policiesOf(data, router);
        expect(listed.slice(0, 2)).toEqual([
            { policy: "transit-import", users: ["import of he"] },
            { policy: "customer-import", users: ["export of he"] },
        ]);
        expect(listed.find((entry) => entry.policy === "sanity")!.users).toEqual([]);
    });
});
