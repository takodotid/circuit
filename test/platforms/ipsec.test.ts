// Route-based IPsec tunnels. FortiOS was tested on a FG-3700D with FortiOS 6.2.2 in multi-VDOM mode, with tunnels between documentation addresses. Tunnels with IPv4 and IPv6 endpoints, AES-GCM and AES-CBC, a key and certificates, were made, changed both ways, and removed, each plan empty after. So were liveness checks on and off, NAT traversal, a NAT keepalive interval, and IPv6 inside.

import { expect, test } from "bun:test";
import type { Device, Ipsec } from "../../src/model";
import { Platforms } from "../../src/platforms";
import { Fixtures } from "../fixtures";

/** A tunnel from the firewall fixture's lab port. */
const TUNNEL: Ipsec = {
    description: "Branch office",
    addresses: [{ address: "10.255.12.1/30", peer_address: "10.255.12.2" }],
    local_address: "198.51.100.193",
    remote_address: "192.0.2.20",
    pre_shared_key: { secret: "IPSEC_KEY" },
    ike: { encryption: "aes-256-gcm", prf: "hmac-sha2-256", dh_group: 19, lifetime: 86400 },
    esp: { encryption: "aes-256-gcm", pfs_group: 19, lifetime: 3600 },
};

/** A fixture's device with these tunnels, and without its GRE and VXLAN tunnels. */
function withTunnels(fixture: string, ipsec: Record<string, Ipsec>): Device {
    const device = Fixtures.device(fixture);
    return { ...device, interfaces: { ...device.interfaces, gre: undefined, vxlan: undefined, ipsec } };
}

const fortios = Platforms.get("fortios");
const options = { secrets: false, rollback: 10 };

test("FortiOS writes a phase 1, a phase 2 named after it, and the tunnel's interface, and plans nothing against its own render", () => {
    const desired = fortios.render(withTunnels("platforms--example-firewall", { "ipsec-branch-1": TUNNEL }));

    expect(desired).toContain(`config vpn ipsec phase1-interface
    edit "ipsec-branch-1"
        set interface "port6"
        set ike-version 2
        set local-gw 198.51.100.193
        set peertype any
        set net-device disable
        set proposal aes256gcm-prfsha256
        set dhgrp 19
        set remote-gw 192.0.2.20
        set psksecret "<secret:IPSEC_KEY>"
    next
end
config vpn ipsec phase2-interface
    edit "ipsec-branch-1"
        set phase1name "ipsec-branch-1"
        set proposal aes256gcm
        set dhgrp 19
        set keylifeseconds 3600
    next
end`);
    expect(desired).toMatch(/edit "ipsec-branch-1"\n {8}set vdom "root"\n {8}set type tunnel\n/);
    expect(desired).toContain("set remote-ip 10.255.12.2 255.255.255.252");
    expect(fortios.plan(desired, desired, { secrets: false, rollback: 10 })).toEqual({ steps: [], problems: [] });
});

test("FortiOS names a cbc encryption's hash in each proposal, and turns PFS off without a group", () => {
    const desired = fortios.render(
        withTunnels("platforms--example-firewall", {
            "ipsec-branch-2": {
                ...TUNNEL,
                ike: { encryption: "aes-128-cbc", integrity: "hmac-sha2-512-256", prf: "hmac-sha2-512", dh_group: 14, lifetime: 28800 },
                esp: { encryption: "aes-256-cbc", integrity: "hmac-sha2-256-128", lifetime: 3600 },
            },
        })
    );

    expect(desired).toContain("set proposal aes128-sha512\n        set dhgrp 14");
    expect(desired).toContain("set proposal aes256-sha256\n        set pfs disable\n        set keylifeseconds 3600");
});

test("FortiOS checks a silent peer, puts ESP in UDP always, and with certificates takes only a peer the CA signed", () => {
    const device = withTunnels("platforms--example-firewall", {
        "ipsec-branch-1": {
            ...TUNNEL,
            pre_shared_key: undefined,
            certificate: "web",
            ca_certificate: "branch-ca",
            liveness_check: { interval: 10, retries: 5 },
            nat_traversal: "always",
        },
        // A liveness check at the device's default timers writes only its mode.
        "ipsec-branch-2": { ...TUNNEL, remote_address: "192.0.2.30", liveness_check: { interval: 20, retries: 3 } },
    });
    const certificates = { ...device.system?.certificates, "branch-ca": { certificate_file: "platforms--example-firewall.web.pem" } };
    const desired = fortios.render({ ...device, system: { ...device.system, certificates } });

    expect(desired).toContain(`config user peer
    edit "branch-ca"
        set ca "branch-ca"
    next
end`);
    expect(desired).toContain(`    edit "ipsec-branch-1"
        set interface "port6"
        set ike-version 2
        set local-gw 198.51.100.193
        set authmethod signature
        set peertype peer
        set net-device disable
        set proposal aes256gcm-prfsha256
        set dpd on-idle
        set nattraversal forced
        set dhgrp 19
        set remote-gw 192.0.2.20
        set certificate "web"
        set peer "branch-ca"
        set dpd-retrycount 5
        set dpd-retryinterval 10
    next
    edit "ipsec-branch-2"
        set interface "port6"
        set ike-version 2
        set local-gw 198.51.100.193
        set peertype any
        set net-device disable
        set proposal aes256gcm-prfsha256
        set dpd on-idle
        set dhgrp 19
        set remote-gw 192.0.2.30
        set psksecret "<secret:IPSEC_KEY>"
    next`);

    // The device doesn't print the peer a tunnel with certificates takes (TRAPS.md).
    const shown = desired.replace("        set peertype peer\n", "");
    expect(fortios.plan(desired, shown, { secrets: false, rollback: 10 })).toEqual({ steps: [], problems: [] });
});

test("FortiOS turns liveness checks off and sets the NAT keepalive interval, which it doesn't print at its default", () => {
    const device = withTunnels("platforms--example-firewall", {
        "ipsec-branch-1": { ...TUNNEL, liveness_check: false, nat_keepalive: 25 },
        "ipsec-branch-2": { ...TUNNEL, remote_address: "192.0.2.30", nat_keepalive: 10 },
    });
    const desired = fortios.render(device);

    expect(desired).toContain(`        set proposal aes256gcm-prfsha256
        set dpd disable
        set keepalive 25
        set dhgrp 19
        set remote-gw 192.0.2.20`);
    expect(desired).toContain(`        set proposal aes256gcm-prfsha256
        set dhgrp 19
        set remote-gw 192.0.2.30`);
});

test("FortiOS unsets what a setting hides before it sets that setting: the liveness timers before `dpd disable`, and forced NAT traversal before the keepalive", () => {
    const current = fortios.render(
        withTunnels("platforms--example-firewall", {
            "ipsec-branch-1": { ...TUNNEL, liveness_check: { interval: 10, retries: 5 }, nat_traversal: "always" },
        })
    );
    const desired = fortios.render(
        withTunnels("platforms--example-firewall", { "ipsec-branch-1": { ...TUNNEL, liveness_check: false, nat_keepalive: 30 } })
    );

    const send = fortios.plan(desired, current, { secrets: false, rollback: 10 }).steps.flatMap((step) => step.send);
    expect(send.join("\n")).toContain(`edit "ipsec-branch-1"
unset dpd-retryinterval
unset dpd-retrycount
unset nattraversal
set dpd disable
set keepalive 30
next`);
});

test("FortiOS carries IPv6 in a second phase 2 when the tunnel has an IPv6 address, and plans nothing against its own render", () => {
    const desired = fortios.render(
        withTunnels("platforms--example-firewall", {
            "ipsec-branch-1": { ...TUNNEL, addresses: [...(TUNNEL.addresses ?? []), "2001:db8:ffee::1/64"] },
        })
    );

    expect(desired).toContain(`    edit "ipsec-branch-1-v6"
        set phase1name "ipsec-branch-1"
        set proposal aes256gcm
        set dhgrp 19
        set keylifeseconds 3600
        set src-addr-type subnet6
        set dst-addr-type subnet6
    next`);
    expect(desired).toMatch(
        /set remote-ip 10\.255\.12\.2 255\.255\.255\.252\n(.*\n)* {8}config ipv6\n {12}set ip6-address 2001:db8:ffee::1\/64\n/
    );
    expect(fortios.plan(desired, desired, { secrets: false, rollback: 10 })).toEqual({ steps: [], problems: [] });

    // Without an IPv6 address, the tunnel has one phase 2.
    expect(fortios.render(withTunnels("platforms--example-firewall", { "ipsec-branch-1": TUNNEL }))).not.toContain(
        `edit "ipsec-branch-1-v6"`
    );
});

/** A tunnel with certificates, from the firewall fixture, and its CA, `branch-ca`. */
function withCertificates(ipsec: Record<string, Ipsec>, vdoms = false): Device {
    const device = withTunnels("platforms--example-firewall", ipsec);
    const certificates = { ...device.system?.certificates, "branch-ca": { certificate_file: "platforms--example-firewall.web.pem" } };
    const management = vdoms ? { vdoms: { management: { name: "mgmt", interfaces: ["1g-1"] } } } : {};
    return { ...device, system: { ...device.system, certificates, ...management } };
}

const CERTIFIED: Ipsec = { ...TUNNEL, pre_shared_key: undefined, certificate: "web", ca_certificate: "branch-ca" };

// Tested on the FG-3700D on 6.2.2, in a test VDOM: a subject added, changed, taken away, and added again with the tunnel removed, each plan empty after. No IKE peer sent a certificate, so it is experimental.
test("FortiOS takes only the peer's certificate with the subject written, through a user peer of the tunnel's own and an exact match", () => {
    const anyCertificate = fortios.render(withCertificates({ "ipsec-branch-1": CERTIFIED }));
    const identity = { distinguished_name: "CN=branch-1,O=Example" };
    const device = withCertificates({ "ipsec-branch-1": { ...CERTIFIED, remote_identity: identity } });
    const desired = fortios.render(device);

    expect(fortios.unsupported(device)).toEqual([]);
    expect(fortios.experimental!(device)).toContain("interfaces.ipsec.ipsec-branch-1.remote_identity");
    expect(desired).toContain(`config vpn certificate setting
    set subject-match value
end
config user peer
    edit "ipsec-branch-1"
        set ca "branch-ca"
        set subject "CN=branch-1,O=Example"
    next
end`);
    expect(desired).toContain('        set certificate "web"\n        set peer "ipsec-branch-1"\n');
    // The device doesn't print the peer a tunnel with certificates takes (TRAPS.md).
    const shown = desired.replace("        set peertype peer\n", "");
    expect(fortios.plan(desired, shown, options)).toEqual({ steps: [], problems: [] });

    const added = fortios.plan(desired, anyCertificate, options).steps;
    expect(added.map((step) => step.title)).toEqual([
        "vpn certificate setting",
        "user peer",
        "vpn ipsec phase1-interface",
        "user peer, removed",
    ]);
    expect(added[0]?.send).toEqual(["config vpn certificate setting", "set subject-match value", "end"]);
    expect(added.at(-1)?.send).toEqual(["config user peer", 'delete "branch-ca"', "end"]);

    const removed = fortios.plan(anyCertificate, desired, options).steps;
    expect(removed[0]?.send).toEqual(["config vpn certificate setting", "unset subject-match", "end"]);
    expect(removed.at(-1)?.send).toEqual(["config user peer", 'delete "ipsec-branch-1"', "end"]);
});

test("in multi-VDOM mode, the exact match is root's, as the tunnels are", () => {
    const device = withCertificates({ "ipsec-branch-1": { ...CERTIFIED, remote_identity: { distinguished_name: "CN=branch-1" } } }, true);
    const current = fortios.render(withCertificates({ "ipsec-branch-1": CERTIFIED }, true));
    const steps = fortios.plan(fortios.render(device), current, options).steps;

    expect(steps[0]?.title).toBe("root: vpn certificate setting");
    expect(steps[0]?.send).toEqual([
        "config vdom",
        "edit root",
        "config vpn certificate setting",
        "set subject-match value",
        "end",
        "next",
        "end",
    ]);
});

test("FortiOS refuses an identity it would look for in the certificate's subject alternative names, and a tunnel named after another tunnel's CA", () => {
    const device = withCertificates({
        "ipsec-branch-1": { ...CERTIFIED, remote_identity: { fqdn: "branch-1.example.net" } },
        "ipsec-branch-2": { ...CERTIFIED, remote_address: "192.0.2.30", remote_identity: { email: "noc@example.net" } },
        "ipsec-branch-3": { ...CERTIFIED, remote_address: "192.0.2.40", remote_identity: { address: "192.0.2.40" } },
        "branch-ca": { ...CERTIFIED, remote_address: "192.0.2.50", remote_identity: { distinguished_name: "CN=branch-5" } },
    });
    const refused = fortios.unsupported(device);
    const alternative = (name: string, kind: string) =>
        `interfaces.ipsec.${name}.remote_identity.${kind}, which RFC 4945 finds in a certificate's subject alternative names: the platform matches the subject alone, so write distinguished_name`;

    expect(refused).toEqual(
        expect.arrayContaining([
            alternative("ipsec-branch-1", "fqdn"),
            alternative("ipsec-branch-2", "email"),
            alternative("ipsec-branch-3", "address"),
        ])
    );
    expect(refused).not.toContainEqual(expect.stringContaining("interfaces.ipsec.branch-ca.remote_identity"));

    const shared = withCertificates({
        "ipsec-branch-1": CERTIFIED,
        "branch-ca": { ...CERTIFIED, remote_address: "192.0.2.50", remote_identity: { distinguished_name: "CN=branch-5" } },
    });
    expect(fortios.unsupported(shared)).toContain(
        "interfaces.ipsec.branch-ca.remote_identity, as the tunnel's user peer, named branch-ca, is the one of the CA branch-ca too: rename the tunnel"
    );
});

test("in multi-VDOM mode, root's phase 1 makes the tunnel's interface before the global steps set it", () => {
    const device = withTunnels("platforms--example-firewall", {});
    const vdoms = { ...device, system: { ...device.system, vdoms: { management: { name: "mgmt", interfaces: ["1g-1"] } } } };
    const current = fortios.render(vdoms);
    const desired = fortios.render({ ...vdoms, interfaces: { ...vdoms.interfaces, ipsec: { "ipsec-branch-1": TUNNEL } } });

    const titles = fortios.plan(desired, current, { secrets: false, rollback: 10 }).steps.map((step) => step.title);
    // NTP answers on every interface with an address, the tunnel's too.
    expect(titles).toEqual([
        "root: vpn ipsec phase1-interface",
        "root: vpn ipsec phase2-interface",
        "root: system dns-server",
        "system interface, tunnels",
        "system ntp",
    ]);
});

test("FortiOS puts the tunnel's interface in its VRF, from the vendor's documentation, and names it experimental", () => {
    const device = withTunnels("platforms--example-firewall", { "ipsec-branch-1": { ...TUNNEL, vrf: "guests" } });
    const desired = fortios.render(device);

    expect(desired).toMatch(/edit "ipsec-branch-1"\n {8}set vdom "root"\n {8}set type tunnel\n[\s\S]*?set vrf 1\n/);
    expect(fortios.experimental?.(device)).toContain("interfaces.ipsec.ipsec-branch-1.vrf");
    expect(fortios.plan(desired, desired, { secrets: false, rollback: 10 })).toEqual({ steps: [], problems: [] });
});

test("FortiOS refuses one hash for integrity and another for the pseudorandom function, a lifetime, a liveness check, or a NAT keepalive out of its range, and an address it can't hold", () => {
    const device = withTunnels("platforms--example-firewall", {
        "ipsec-branch-1": {
            ...TUNNEL,
            addresses: ["10.255.12.1/30", "2001:db8:ffee::1/64", "2001:db8:ffef::1/64"],
            local_address: "203.0.113.99",
            ike: { encryption: "aes-256-cbc", integrity: "hmac-sha2-256-128", prf: "hmac-sha2-512", dh_group: 14, lifetime: 60 },
            liveness_check: { interval: 3601, retries: 11 },
            nat_keepalive: 901,
        },
        "ipsec-branch-2": {
            ...TUNNEL,
            addresses: [{ address: "2001:db8:ffee::1/64", peer_address: "2001:db8:fff0::2" }],
            nat_traversal: "always",
            nat_keepalive: 9,
        },
    });

    expect(fortios.unsupported(device)).toEqual(
        expect.arrayContaining([
            "interfaces.ipsec.ipsec-branch-1.local_address, no interface holds 203.0.113.99",
            "interfaces.ipsec.ipsec-branch-1.ike.prf hmac-sha2-512 with integrity hmac-sha2-256-128: the platform uses one hash for both",
            "interfaces.ipsec.ipsec-branch-1.ike.lifetime 60, the platform takes 120 to 172800",
            "interfaces.ipsec.ipsec-branch-1.liveness_check.interval 3601, the platform takes up to 3600",
            "interfaces.ipsec.ipsec-branch-1.liveness_check.retries 11, the platform takes up to 10",
            "interfaces.ipsec.ipsec-branch-1.nat_keepalive 901, the platform takes 10 to 900",
            "interfaces.ipsec.ipsec-branch-1.addresses, an IPv4 address on a tunnel takes its peer",
            "interfaces.ipsec.ipsec-branch-1.addresses, one IPv6 address",
            "interfaces.ipsec.ipsec-branch-2.nat_keepalive 9, the platform takes 10 to 900",
            "interfaces.ipsec.ipsec-branch-2.nat_keepalive with nat_traversal always: the platform has no keepalive interval while ESP always goes in UDP",
            "interfaces.ipsec.ipsec-branch-2.addresses, a peer on an IPv6 address",
        ])
    );
});

test("FortiOS refuses IPv6 in a tunnel when another tunnel has the name of its phase 2 for IPv6", () => {
    const device = withTunnels("platforms--example-firewall", {
        "ipsec-branch-1": { ...TUNNEL, addresses: [{ address: "10.255.12.1/30", peer_address: "10.255.12.2" }, "2001:db8:ffee::1/64"] },
        "ipsec-branch-1-v6": TUNNEL,
    });

    expect(fortios.unsupported(device)).toContain(
        "interfaces.ipsec.ipsec-branch-1.addresses, IPv6 in the tunnel while another tunnel is named ipsec-branch-1-v6, which its phase 2 for IPv6 takes"
    );
});

test("Junos, VRP, and Raisecom ROS refuse it, since the switches don't encrypt what they forward, and so does RouterOS", () => {
    for (const fixture of ["platforms--example-aggregation-switch", "platforms--example-switch", "platforms--example-core-switch"]) {
        const device = withTunnels(fixture, { "ipsec-branch-1": TUNNEL });
        expect(Platforms.get(device.platform).unsupported(device)).toContainEqual(
            expect.stringMatching(/^interfaces\.ipsec\.ipsec-branch-1, IPsec: .* does not encrypt the traffic it forwards$/)
        );
    }

    const router = withTunnels("platforms--example-router", { "ipsec-branch-1": TUNNEL });
    expect(Platforms.get("routeros").unsupported(router)).toContain(
        "interfaces.ipsec.ipsec-branch-1, which RouterOS has only from 7.25, where it cut a router off in a test (TRAPS.md). Write a policy-based tunnel in firewall.ipsec"
    );
});
