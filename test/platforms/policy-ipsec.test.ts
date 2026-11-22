// Policy-based IPsec tunnels, `firewall.ipsec`. RouterOS was proven on two CHRs with 7.24.6 (test/platforms/routeros-chr-ipsec.test.ts). The other platforms refuse them.

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

test("Junos, VRP, and Raisecom ROS refuse a policy-based tunnel, since the switches don't encrypt what they forward, and FortiOS hasn't built it yet", () => {
    for (const fixture of ["platforms--example-aggregation-switch", "platforms--example-switch", "platforms--example-core-switch"]) {
        const device = withTunnels(fixture, { "branch-1": TUNNEL });
        expect(Platforms.get(device.platform).unsupported(device)).toContainEqual(
            expect.stringMatching(/^firewall\.ipsec, IPsec: .* does not encrypt the traffic it forwards$/)
        );
    }

    const firewall = withTunnels("platforms--example-firewall", { "branch-1": TUNNEL });
    expect(Platforms.get("fortios").unsupported(firewall)).toContain(
        "firewall.ipsec, a policy-based IPsec tunnel, not built yet: write a route-based tunnel in interfaces.ipsec"
    );
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
