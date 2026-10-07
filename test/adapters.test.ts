// Every example validates, renders, and plans nothing against its own render. A plan that is not empty there means the reader and the renderer disagree on a form, which would show up as a change on every apply.

import { describe, expect, test } from "bun:test";
import { adapters } from "../src/adapters/devices";
import { defineNetwork } from "../src/core/define";
import { validate } from "../src/core/validate";
import coreSwitch from "../examples/core-switch";
import router from "../examples/router";
import switchDevice from "../examples/switch";

const examples = [router, switchDevice, coreSwitch];

describe("examples", () => {
    test("validate", () => {
        const findings = validate(defineNetwork({ devices: examples }));
        expect(findings).toEqual([]);
    });

    for (const device of examples) {
        test(`${device.name} plans nothing against its own render`, () => {
            const adapter = adapters[device.platform]!;
            const rendered = adapter.render(device);
            const plan = adapter.plan(rendered, rendered, { secrets: false, rollback: 10 });
            expect(plan.problems).toEqual([]);
            expect(plan.steps.flatMap((step) => step.show)).toEqual([]);
        });
    }
});

// The forms a Raisecom switch prints, seen on a RAX721: an access group with its notify view, an SNMPv3 user as localized keys, and `portswitch` on a switched LAG.
test("example-core-switch plans nothing against how the device prints it", () => {
    const adapter = adapters["raisecom-ros"]!;
    const rendered = adapter.render(coreSwitch);
    const printed = rendered
        .replace(
            /^snmp-server access (\S+) read internet usm authpriv$/m,
            "snmp-server access $1 read internet notify internet usm authpriv"
        )
        .replace(
            /^snmp-server user (\S+) authentication sha \S+ privacy aes128 \S+$/m,
            "snmp-server user $1 authkey sha <redacted> privkey  aes128 <redacted>"
        )
        .replace(/^interface port-channel (\d+)$/m, "interface port-channel $1\nportswitch");

    expect(printed).not.toEqual(rendered);

    const plan = adapter.plan(rendered, printed, { secrets: false, rollback: 10 });
    expect(plan.steps.flatMap((step) => step.show)).toEqual([]);
});

// Undoing a whole VLAN list line deletes VLANs still in use, which a switch refuses; only the change is sent.
test("a VLAN list change sends only the VLANs added and removed", () => {
    const options = { secrets: false, rollback: 10 };

    const vrp = adapters["vrp"]!.plan("vlan batch 10 20 to 21 127\n", "vlan batch 10 20 to 22 99\n", options);
    expect(vrp.steps.flatMap((step) => step.send)).toEqual(["undo vlan batch 22 99", "vlan batch 127"]);

    const raisecom = adapters["raisecom-ros"]!.plan("create vlan 10,20-21,127 active\n", "create vlan 10,20-22,99 active\n", options);
    expect(raisecom.steps.flatMap((step) => step.send)).toEqual(["no vlan 22", "no vlan 99", "create vlan 127 active"]);
});

// Presets are plain config: what they return is what a device holds.
test("presets build the rules they describe", async () => {
    const { antiSpoofing, badTcpFlags, bgpSanity, exportsEndInReject, MARTIANS } = await import("../src/presets");

    expect(antiSpoofing("ix", MARTIANS).map((rule) => rule.match?.src)).toEqual([...MARTIANS]);
    expect(badTcpFlags()).toHaveLength(6);
    expect(bgpSanity().map((rule) => rule.description)).toEqual([
        "IPv4 shorter than /8",
        "IPv4 longer than /24",
        "IPv6 shorter than /16",
        "IPv6 longer than /48",
        "RPKI invalid",
    ]);

    const findings = exportsEndInReject([{ ...router, policies: { ...router.policies, "UPSTREAM-OUT": [{ action: "accept" }] } }]);
    expect(findings.map((finding) => finding.message)).toContain("upstream-1: export UPSTREAM-OUT does not end in an unconditional reject");
});

test("antiAmplification accepts trusted sources, then drops fragments and every amplifier, one switch rule per port", async () => {
    const { antiAmplification, AMPLIFIERS } = await import("../src/presets");
    const rules = antiAmplification(["198.51.100.0/24"], ["192.0.2.53/32"]);

    expect(rules.slice(0, 2)).toEqual([
        {
            description: "UDP to 198.51.100.0/24 from 192.0.2.53/32",
            match: { protocol: "udp", src: "192.0.2.53/32", dst: "198.51.100.0/24" },
            action: "accept",
        },
        {
            description: "UDP fragments to 198.51.100.0/24",
            match: { protocol: "udp", dst: "198.51.100.0/24", src_port: 0 },
            action: "drop",
        },
    ]);
    expect(rules.slice(2).map((rule) => rule.match?.src_port)).toEqual(Object.values(AMPLIFIERS));

    const listed = {
        ...router,
        acls: { edge: [{ description: "Two ports", match: { protocol: "udp" as const, src_port: [53, 123] }, action: "drop" as const }] },
    };
    const rendered = adapters["routeros"]!.render(listed);
    expect(rendered.match(/comment="Two ports".*/g)?.map((line) => line.match(/src-port=\S+/)?.[0])).toEqual([
        "src-port=53",
        "src-port=123",
    ]);
});

test("trustBoundary finds an untrusted VLAN beside a trusted one away from a router", async () => {
    const { trustBoundary, vlansOf } = await import("../src/presets");

    expect(vlansOf({ access_vlan: "a", trunk_vlans: ["b"] })).toEqual(["a", "b"]);

    const check = trustBoundary({ untrusted: ["guests"], routers: ["example-router"] });
    expect(check([switchDevice]).map((finding) => finding.message)).toEqual([
        "LAG uplink carries an untrusted VLAN beside a trusted one and does not face a router",
        "interface guests puts an address on untrusted VLAN guests; only a router may",
    ]);
});

test("merge refuses a name two records hold", async () => {
    const { merge } = await import("../src/core/merge");

    expect(merge({ a: 1 }, { b: 2 })).toEqual({ a: 1, b: 2 });
    expect(() => merge({ a: 1 }, { a: 2 })).toThrow("merge: a is declared twice");
});

// Templates are what `circuit new` copies and what the pattern pages show; use cases are what the use case pages show. Each validates, with its own checks, and plans nothing against its own render.
describe("templates and use cases", () => {
    const configs = [
        ...["single-site", "edge-router", "colocation"].map((pattern) => `../templates/${pattern}`),
        ...["ip-transit", "ix-transit", "internet-exchange", "virtual-exchange"].map((useCase) => `../examples/use-cases/${useCase}`),
    ];

    for (const directory of configs) {
        test(directory, async () => {
            const network = (await import(`${directory}/circuit.config.ts`)).default;
            const findings = validate(network).filter((finding) => finding.level === "error");
            expect(findings).toEqual([]);

            for (const device of network.devices) {
                const adapter = adapters[device.platform]!;
                const rendered = adapter.render(device);
                const plan = adapter.plan(rendered, rendered, { secrets: false, rollback: 10 });
                expect(plan.problems).toEqual([]);
                expect(plan.steps.flatMap((step) => step.show)).toEqual([]);
            }
        });
    }
});

test("communityScheme blackholes only inside the customer's space, and never announces it", async () => {
    const { communityScheme } = await import("../src/presets");
    const communities = communityScheme({
        asn: 64500,
        learned_from: { function: 1, classes: { customer: 3 } },
        blackhole: { function: 666, upstreams: { 64501: "64501:666" } },
    });

    expect(communities.blackhole(["customer-v4", "customer-v6"])).toEqual(
        (["customer-v4", "customer-v6"] as const).map((prefixSet) => ({
            description: "Blackhole, asked by the neighbor",
            match: { large_community: "64500:666:0", prefix_set: prefixSet },
            set: { blackhole: true as const },
            action: "accept" as const,
        }))
    );
    expect(communities.actions(64502)[0]).toMatchObject({ match: { large_community: "64500:666:0" }, action: "reject" });
    expect(communities.catalogue).toContainEqual({
        community: "64500:666:0",
        description: "Blackhole: dropped in AS64500 and by its upstreams that take it",
    });

    // A neighbor with its own blackhole community gets the route, tagged with it, and none of ours.
    const passed = communities.actions(64501).find((rule) => rule.description === "Blackhole passed on to AS64501")!;
    expect(passed).toMatchObject({ action: "accept", set: { add_communities: ["64501:666"], remove_large_communities: ["64500:*:*"] } });
});

test("exportsEndInReject leaves out an export to a customer", async () => {
    const { exportsEndInReject } = await import("../src/presets");
    const policies = { ...router.policies, "UPSTREAM-OUT": [{ action: "accept" as const }] };
    const bgp = router.routing!.bgp!;
    const asCustomer = { ...bgp, groups: { upstream: { ...bgp.groups!.upstream!, role: "customer" as const } } };
    const aboutUpstream = (devices: Parameters<typeof exportsEndInReject>[0]) =>
        exportsEndInReject(devices).filter((finding) => finding.message.startsWith("upstream-1"));

    expect(aboutUpstream([{ ...router, policies }])).toHaveLength(1);
    expect(aboutUpstream([{ ...router, policies, routing: { ...router.routing, bgp: asCustomer } }])).toEqual([]);
});

test("internetExchange keeps members apart", async () => {
    const { internetExchange } = await import("../src/presets");
    const member = { name: "a", asn: 64510, ports: {}, ipv4: "203.0.113.1" };
    const exchange = internetExchange({ vlan: "peering", lan: { ipv4: "203.0.113.0/24" }, reserved: ["203.0.113.1"] }, [
        member,
        { ...member, name: "b" },
    ]);

    expect(exchange.check([]).map((finding) => finding.message)).toEqual([
        "members a and b share AS64510",
        "203.0.113.1 of a is already reserved",
        "203.0.113.1 of b is already a's",
    ]);
});

test("prometheus lists every device with SNMP, each with its own auth, and no secret in the auths", async () => {
    const { prometheusTargets, snmpExporterAuths } = await import("../src/adapters/registries/prometheus");
    const network = defineNetwork({ devices: [router, switchDevice] });

    expect(prometheusTargets(network).targets.map((target) => [target.targets, target.labels.__param_auth])).toEqual([
        [["192.0.2.1"], "example-router"],
        [["192.0.2.2"], "example-switch"],
    ]);

    const { yaml, notes } = snmpExporterAuths(network);
    expect(yaml).toContain(
        "  example-switch:\n    version: 3\n    username: monitor\n    security_level: authPriv\n    password: ${EXAMPLE_SNMP_AUTH}"
    );
    expect(yaml).toContain("    priv_password: ${EXAMPLE_SNMP_PRIVACY}");
    expect(notes).toEqual([]);
});

test("librenms adds what it does not monitor, with the device's SNMP version 3 user", async () => {
    const { planLibreNms, sendLibreNms } = await import("../src/adapters/registries/librenms");
    const { secret } = await import("../src/core/define");
    for (const name of ["LIBRENMS_TOKEN", "EXAMPLE_SNMP_AUTH", "EXAMPLE_SNMP_PRIVACY"]) process.env[name] = `${name}-value`;

    const sent: { url: string; init?: RequestInit }[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
        sent.push({ url, init });
        const body =
            init?.method === "POST"
                ? { status: "ok", message: "added" }
                : { devices: [{ hostname: "192.0.2.1" }, { hostname: "198.51.100.9" }] };
        return new Response(JSON.stringify(body));
    }) as typeof fetch;

    try {
        const network = defineNetwork({
            devices: [router, switchDevice],
            librenms: { url: "https://librenms.example/", api_token: secret("LIBRENMS_TOKEN") },
        });
        const plan = await planLibreNms(network);

        expect(plan.additions.map((device) => device.name)).toEqual(["example-switch"]);
        expect(plan.unknown).toEqual(["198.51.100.9"]);

        await sendLibreNms(network, plan.additions);
        const post = sent.at(-1)!;
        expect(post.url).toBe("https://librenms.example/api/v0/devices");
        expect((post.init!.headers as Record<string, string>)["X-Auth-Token"]).toBe("LIBRENMS_TOKEN-value");
        expect(JSON.parse(post.init!.body as string)).toEqual({
            hostname: "192.0.2.2",
            display_template: "example-switch",
            snmpver: "v3",
            authlevel: "authPriv",
            authname: "monitor",
            authpass: "EXAMPLE_SNMP_AUTH-value",
            authalgo: "SHA",
            cryptopass: "EXAMPLE_SNMP_PRIVACY-value",
            cryptoalgo: "AES",
        });
    } finally {
        globalThis.fetch = original;
    }
});

test("a trusted neighbor keeps its requests; anyone else loses every community of ours", async () => {
    const { communityScheme } = await import("../src/presets");
    const communities = communityScheme({
        asn: 64500,
        learned_from: { function: 1, classes: { transit: 1, customer: 3 } },
        do_not_announce: 100,
        blackhole: { function: 666 },
    });

    expect(communities.tag("customer", 65550, { trusted: true }).set?.remove_large_communities).toEqual(["64500:1:*"]);
    expect(communities.tag("customer", 65551).set?.remove_large_communities).toEqual(["64500:*:*"]);
    expect(communities.tag("transit", 6939).set?.remove_large_communities).toEqual(["64500:*:*"]);
});
