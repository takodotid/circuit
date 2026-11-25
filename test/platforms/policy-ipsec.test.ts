// Policy-based IPsec tunnels, `firewall.ipsec`. RouterOS was proven on two CHRs with 7.24.6 (test/platforms/routeros-chr-ipsec.test.ts). FortiOS was proven on a FG-3700D with 6.2.2, against a second VDOM. The switches refuse them.

import { expect, test } from "bun:test";
import { Checks } from "../../src/checks";
import type { Device, PolicyIpsec } from "../../src/model";
import { Platforms } from "../../src/platforms";
import { Fixtures } from "../fixtures";

/** A tunnel from the router fixture's uplink, for its servers' prefixes of both families. */
const TUNNEL: PolicyIpsec = {
    description: "Branch office",
    local_address: "203.0.113.2",
    remote_address: "192.0.2.30",
    traffic_selectors: [
        { local_prefix: "198.51.100.64/26", remote_prefix: "203.0.113.128/25" },
        { local_prefix: "2001:db8:20::/64", remote_prefix: "2001:db8:300::/48" },
    ],
    pre_shared_key: { secret: "IPSEC_KEY" },
    ike: { encryption: "aes-256-cbc", integrity: "hmac-sha2-256-128", prf: "hmac-sha2-256", dh_group: 14, lifetime: 28800 },
    esp: { encryption: "aes-256-cbc", integrity: "hmac-sha2-256-128", pfs_group: 19, lifetime: 3600 },
};

/** A fixture's device with these tunnels. */
function withTunnels(fixture: string, ipsec: Record<string, PolicyIpsec>): Device {
    const device = Fixtures.device(fixture);
    return { ...device, firewall: { ...device.firewall, ipsec } };
}

const routeros = Platforms.get("routeros");
const options = { secrets: false, rollback: 10 };
const messages = (device: Device) => Checks.run([device], undefined).map((finding) => finding.message);

test("RouterOS writes a profile, a proposal, a peer, and an identity of the tunnel's name, and a policy for each selector, and plans nothing against its own render", () => {
    const desired = routeros.render(withTunnels("platforms--example-router", { "branch-1": TUNNEL }));

    expect(desired).toContain(`/ip ipsec profile
add dh-group=modp2048 enc-algorithm=aes-256 hash-algorithm=sha256 lifetime=8h name=branch-1 prf-algorithm=sha256
/ip ipsec proposal
add auth-algorithms=sha256 enc-algorithms=aes-256-cbc lifetime=1h name=branch-1 pfs-group=ecp256
/ip ipsec peer
add address=192.0.2.30/32 comment="Branch office" exchange-mode=ike2 local-address=203.0.113.2 name=branch-1 profile=branch-1
/ip ipsec identity
add peer=branch-1 secret="<secret:IPSEC_KEY>"
/ip ipsec policy
add dst-address=203.0.113.128/25 peer=branch-1 proposal=branch-1 src-address=198.51.100.64/26 tunnel=yes
add dst-address=2001:db8:300::/48 peer=branch-1 proposal=branch-1 src-address=2001:db8:20::/64 tunnel=yes
`);
    expect(routeros.plan(desired, desired, options)).toEqual({ steps: [], problems: [] });
});

test("RouterOS writes AES-GCM in ESP without a hash, no PFS as none, certificates as a digital signature, and no liveness checks", () => {
    const tunnel: PolicyIpsec = {
        ...TUNNEL,
        pre_shared_key: undefined,
        certificate: "web",
        ca_certificate: "web",
        esp: { encryption: "aes-128-gcm", lifetime: 1800 },
        liveness_check: false,
    } as PolicyIpsec;
    const desired = routeros.render(withTunnels("platforms--example-router", { "branch-1": tunnel }));

    expect(desired).toContain(
        "add dh-group=modp2048 dpd-interval=disable-dpd enc-algorithm=aes-256 hash-algorithm=sha256 lifetime=8h name=branch-1 prf-algorithm=sha256"
    );
    expect(desired).toContain('add auth-algorithms="" enc-algorithms=aes-128-gcm lifetime=30m name=branch-1 pfs-group=none');
    expect(desired).toContain("add auth-method=digital-signature certificate=web peer=branch-1");
    expect(routeros.plan(desired, desired, options).steps).toEqual([]);
});

test("RouterOS finds the policy of an IPv4 host by its whole prefix, which a bare address would miss", () => {
    const host = { ...TUNNEL, traffic_selectors: [{ local_prefix: "198.51.100.65/32", remote_prefix: "203.0.113.128/25" }] } as PolicyIpsec;
    const withHost = routeros.render(withTunnels("platforms--example-router", { "branch-1": host }));
    const without = routeros.render(Fixtures.device("platforms--example-router"));

    expect(routeros.plan(without, withHost, options).steps.flatMap((step) => step.send)).toContain(
        '/ip ipsec policy remove [ find src-address="198.51.100.65/32" and dst-address="203.0.113.128/25" ]'
    );
});

test("RouterOS adds a tunnel's entries in order, and removes them in the reverse order", () => {
    const without = routeros.render(Fixtures.device("platforms--example-router"));
    const withTunnel = routeros.render(withTunnels("platforms--example-router", { "branch-1": TUNNEL }));

    const menus = (desired: string, current: string) =>
        routeros
            .plan(desired, current, options)
            .steps.map((step) => step.title)
            .filter((title) => title.startsWith("/ip ipsec"));
    expect(menus(withTunnel, without)).toEqual([
        "/ip ipsec profile",
        "/ip ipsec proposal",
        "/ip ipsec peer",
        "/ip ipsec identity",
        "/ip ipsec policy",
    ]);
    expect(menus(without, withTunnel)).toEqual([
        "/ip ipsec policy",
        "/ip ipsec identity",
        "/ip ipsec peer",
        "/ip ipsec proposal",
        "/ip ipsec profile",
    ]);
});

test("RouterOS refuses AES-GCM in IKE, an address it doesn't hold or holds in a VRF, and a CA beside another or not there", () => {
    const device = withTunnels("platforms--example-router", {
        default: {
            ...TUNNEL,
            traffic_selectors: [{ local_prefix: "198.51.100.64/26", remote_prefix: "203.0.113.128/26" }],
            ike: { encryption: "aes-256-gcm", prf: "hmac-sha2-256", dh_group: 19, lifetime: 86400 },
        },
        "branch-2": {
            ...TUNNEL,
            local_address: "198.51.100.129",
            traffic_selectors: [{ local_prefix: "198.51.100.128/26", remote_prefix: "203.0.113.192/26" }],
        },
        "branch-3": {
            ...TUNNEL,
            local_address: "192.0.2.77",
            traffic_selectors: [{ local_prefix: "198.51.100.0/30", remote_prefix: "203.0.113.192/26" }],
            pre_shared_key: undefined,
            certificate: "web",
            ca_certificate: "branch-ca",
        } as PolicyIpsec,
        "branch-4": {
            ...TUNNEL,
            traffic_selectors: [{ local_prefix: "198.51.100.4/30", remote_prefix: "203.0.113.192/26" }],
            pre_shared_key: undefined,
            certificate: "web",
            ca_certificate: "missing-ca",
        } as PolicyIpsec,
    });
    device.system = {
        ...device.system,
        certificates: {
            ...device.system?.certificates,
            "branch-ca": { certificate_file: "ca.pem" },
            "syslog-ca": { certificate_file: "ca.pem" },
        },
    };

    expect(routeros.unsupported(device)).toEqual(
        expect.arrayContaining([
            "firewall.ipsec.default: the name of RouterOS's own IPsec profile and proposal, which the tunnel's take. Write another name",
            "firewall.ipsec.default.ike.encryption aes-256-gcm: RouterOS's IKE has no AES-GCM. Write aes-128-cbc or aes-256-cbc, with integrity",
            "firewall.ipsec.branch-2.local_address 198.51.100.129, on interfaces.vlan_interface.guests in VRF guests: RouterOS runs IKE in the main table only (TRAPS.md)",
            "firewall.ipsec.branch-3.local_address 192.0.2.77: no port or interface of the device holds it",
            "firewall.ipsec.branch-4.ca_certificate missing-ca: no certificate of system.certificates has that name",
            "firewall.ipsec.branch-3.ca_certificate branch-ca: RouterOS takes a peer's certificate that any certificate it holds signed, and it holds syslog-ca too. Keep branch-ca the only certificate without a private key",
        ])
    );
});

test("RouterOS refuses a policy-based tunnel beside a fast_path rule, whose flows would skip the tunnel's policies", () => {
    const device = withTunnels("platforms--example-router", { "branch-1": TUNNEL });
    device.firewall = {
        ...device.firewall,
        filter: { forward: { rules: [{ if: { connection_state: ["established", "related"] }, then: "accept", fast_path: true }] } },
    };

    expect(routeros.unsupported(device)).toContain(
        "firewall.ipsec beside a fast_path rule, whose flows skip IPsec's policies: take fast_path off"
    );
});

test("Junos, VRP, and Raisecom ROS refuse a policy-based tunnel, since the switches don't encrypt what they forward", () => {
    for (const fixture of ["platforms--example-aggregation-switch", "platforms--example-switch", "platforms--example-core-switch"]) {
        const device = withTunnels(fixture, { "branch-1": TUNNEL });
        expect(Platforms.get(device.platform).unsupported(device)).toContainEqual(
            expect.stringMatching(/^firewall\.ipsec, IPsec: .* does not encrypt the traffic it forwards$/)
        );
    }
});

const fortios = Platforms.get("fortios");

const sent = (desired: string, current: string) => fortios.plan(desired, current, options).steps.flatMap((step) => step.send);

/** A tunnel from the firewall fixture's uplink, for its servers and its lab host. */
const FORTIOS_TUNNEL: PolicyIpsec = {
    ...TUNNEL,
    local_address: "203.0.113.10",
    traffic_selectors: [
        { local_prefix: "198.51.100.32/27", remote_prefix: "203.0.113.128/25" },
        { local_prefix: "198.51.100.192/27", remote_prefix: "203.0.113.128/25" },
    ],
};

/** The tunnel's phases as the FG-3700D on 6.2.2 printed them, with names and addresses replaced: `peertype any`, the key encrypted, no `keylife` at its default. */
const FORTIOS_PRINTED = `config vpn ipsec phase1
    edit "branch-1"
        set interface "uplink"
        set ike-version 2
        set local-gw 203.0.113.10
        set keylife 28800
        set peertype any
        set proposal aes256-sha256
        set dhgrp 14
        set remote-gw 192.0.2.30
        set psksecret ENC 1fA4w60vgis30hpvpwQiVAaM0yTPLvs/YNN+T13CoucyTPqBvUXTMcEvAqLXsIUYLi0923qedzC4ji7Lf
    next
end
config vpn ipsec phase2
    edit "branch-1-1"
        set phase1name "branch-1"
        set proposal aes256-sha256
        set dhgrp 19
        set keylifeseconds 3600
        set src-subnet 198.51.100.32 255.255.255.224
        set dst-subnet 203.0.113.128 255.255.255.128
    next
    edit "branch-1-2"
        set phase1name "branch-1"
        set proposal aes256-sha256
        set dhgrp 19
        set keylifeseconds 3600
        set src-subnet 198.51.100.192 255.255.255.224
        set dst-subnet 203.0.113.128 255.255.255.128
    next
end
`;

const phases = /^config vpn ipsec phase[12]\n[\s\S]*?^end\n/gm;

// Against a second VDOM over a link between the two, both selectors' SAs came up, and pings crossed both ways in ESP, with a key, then with certificates.
test("FortiOS writes a phase 1 and a phase 2 for each selector, and a policy that sends each selector's traffic into the tunnel, ahead of the forward chain", () => {
    const device = withTunnels("platforms--example-firewall", { "branch-1": FORTIOS_TUNNEL });
    const desired = fortios.render(device);

    expect(fortios.unsupported(device).filter((gap) => gap.startsWith("firewall.ipsec"))).toEqual([]);
    expect(desired.match(phases)!.join("")).toBe(`config vpn ipsec phase1
    edit "branch-1"
        set interface "uplink"
        set ike-version 2
        set local-gw 203.0.113.10
        set keylife 28800
        set peertype any
        set proposal aes256-sha256
        set dhgrp 14
        set remote-gw 192.0.2.30
        set psksecret "<secret:IPSEC_KEY>"
    next
end
config vpn ipsec phase2
    edit "branch-1-1"
        set phase1name "branch-1"
        set proposal aes256-sha256
        set dhgrp 19
        set keylifeseconds 3600
        set src-subnet 198.51.100.32 255.255.255.224
        set dst-subnet 203.0.113.128 255.255.255.128
    next
    edit "branch-1-2"
        set phase1name "branch-1"
        set proposal aes256-sha256
        set dhgrp 19
        set keylifeseconds 3600
        set src-subnet 198.51.100.192 255.255.255.224
        set dst-subnet 203.0.113.128 255.255.255.128
    next
end
`);
    expect(desired).toContain(`config firewall policy
    edit 1
        set srcintf "servers"
        set dstintf "uplink"
        set srcaddr "198.51.100.32/27"
        set dstaddr "203.0.113.128/25"
        set action ipsec
        set schedule "always"
        set service "ALL"
        set inbound enable
        set vpntunnel "branch-1"
        set comments "Branch office"
    next
    edit 2
        set srcintf "port6"
`);
    expect(
        sent(
            desired,
            desired.replace(/^config vpn ipsec phase1\n[\s\S]*?^end\n(?:config vpn ipsec phase2\n[\s\S]*?^end\n)/m, FORTIOS_PRINTED)
        )
    ).toEqual([]);
});

// With certificates, the firewall printed no `peertype peer`, as for a route-based tunnel.
test("FortiOS writes a policy-based tunnel's certificate, its CA's user peer, and no liveness checks, and adds its entries before the policies that name them", () => {
    const tunnel = {
        ...FORTIOS_TUNNEL,
        pre_shared_key: undefined,
        certificate: "web",
        ca_certificate: "web",
        liveness_check: false,
    } as PolicyIpsec;
    const device = withTunnels("platforms--example-firewall", { "branch-1": tunnel });
    const desired = fortios.render(device);
    const phase1 = desired.match(phases)![0];

    for (const line of ["set authmethod signature", "set peertype peer", "set dpd disable", 'set certificate "web"', 'set peer "web"'])
        expect(phase1).toContain(line);
    expect(sent(desired, desired.replace("        set peertype peer\n", ""))).toEqual([]);

    const titles = fortios
        .plan(desired, fortios.render(Fixtures.device("platforms--example-firewall")), options)
        .steps.map((step) => step.title)
        .filter((title) => /^(user peer|vpn ipsec|firewall (address|policy))/.test(title));
    expect(titles).toEqual(["user peer", "vpn ipsec phase1", "vpn ipsec phase2", "firewall address", "firewall policy"]);
});

test("FortiOS refuses IPv6 in a policy-based tunnel, a local prefix no interface leads to, and a name too long for its phase 2s", () => {
    const device = withTunnels("platforms--example-firewall", {
        "branch-1": TUNNEL,
        "branch-2": { ...FORTIOS_TUNNEL, traffic_selectors: [{ local_prefix: "10.20.0.0/16", remote_prefix: "203.0.113.0/26" }] },
        "a-tunnel-whose-name-has-34-letters": {
            ...FORTIOS_TUNNEL,
            traffic_selectors: [{ local_prefix: "198.51.100.32/28", remote_prefix: "203.0.113.64/26" }],
        },
    });

    expect(fortios.unsupported(device).filter((gap) => gap.startsWith("firewall.ipsec"))).toEqual([
        "firewall.ipsec.branch-1.local_address, no interface holds 203.0.113.2",
        "firewall.ipsec.branch-1.traffic_selectors[1], IPv6: a FortiOS 6.2 policy-based tunnel carries IPv4 only. Write a route-based tunnel in interfaces.ipsec",
        "firewall.ipsec.branch-2.traffic_selectors[0].local_prefix 10.20.0.0/16: no interface has a network in it or holding it, and no static route inside it leaves through one. FortiOS's policy for the tunnel names the interfaces this traffic arrives on",
        "firewall.ipsec.a-tunnel-whose-name-has-34-letters, a name of 34 characters: its last phase 2, a-tunnel-whose-name-has-34-letters-1, passes the 35 the platform takes",
    ]);
});

test("validate takes whole prefixes of one family, at least one selector, and no traffic two selectors share", () => {
    const device = withTunnels("platforms--example-router", {
        "branch-1": {
            ...TUNNEL,
            traffic_selectors: [
                { local_prefix: "198.51.100.65/26", remote_prefix: "203.0.113.128/25" },
                { local_prefix: "198.51.100.64/26", remote_prefix: "2001:db8:300::/48" },
                { local_prefix: "198.51.100.64/27", remote_prefix: "203.0.113.0/24" },
            ],
        },
        "branch-2": { ...TUNNEL, traffic_selectors: [] },
        "branch-3": { ...TUNNEL, traffic_selectors: [{ local_prefix: "198.51.100.0/24", remote_prefix: "203.0.113.192/26" }] },
    });

    expect(messages(device)).toEqual(
        expect.arrayContaining([
            "firewall.ipsec.branch-1.traffic_selectors[0].local_prefix 198.51.100.65/26 has bits past its length: write 198.51.100.64/26",
            "firewall.ipsec.branch-1.traffic_selectors[1]: local_prefix 198.51.100.64/26 and remote_prefix 2001:db8:300::/48 differ in family",
            "firewall.ipsec.branch-2.traffic_selectors is empty: write the local_prefix and remote_prefix whose traffic the tunnel carries",
            "firewall.ipsec.branch-3.traffic_selectors[0] takes traffic that firewall.ipsec.branch-1.traffic_selectors[2] takes too, from 198.51.100.0/24 to 203.0.113.192/26: the device would send it through either. Narrow one of them",
        ])
    );
});

test("a tunnel between two of our devices has the same selectors at the far end, each from its own side", () => {
    const near = withTunnels("platforms--example-router", { "branch-1": TUNNEL });
    const far: Device = {
        ...Fixtures.device("platforms--example-router"),
        name: "branch-01",
        interfaces: { ethernet: { "1g-1": { addresses: ["192.0.2.30/30"] } } },
        firewall: {
            ipsec: {
                hq: {
                    ...TUNNEL,
                    local_address: "192.0.2.30",
                    remote_address: "203.0.113.2",
                    traffic_selectors: [{ local_prefix: "203.0.113.128/25", remote_prefix: "198.51.100.64/26" }],
                },
            },
        },
    } as Device;

    expect(Checks.run([near, far], undefined).map((finding) => finding.message)).toContain(
        "firewall.ipsec.branch-1: traffic_selectors take 2001:db8:20::/64 to 2001:db8:300::/48, and branch-01 firewall.ipsec.hq has no selector from 2001:db8:300::/48 to 2001:db8:20::/64. Write the same selectors at both ends, each from its own side"
    );
});
