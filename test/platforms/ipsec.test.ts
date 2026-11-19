// Route-based IPsec tunnels. FortiOS was tested on a FG-3700D with FortiOS 6.2.2 in multi-VDOM mode, with tunnels between documentation addresses. Tunnels with IPv4 and IPv6 endpoints, AES-GCM and AES-CBC, were made, changed both ways, and removed, each plan empty after.

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

test("FortiOS refuses one hash for integrity and another for the pseudorandom function, a lifetime out of its range, and an address it can't hold", () => {
    const device = withTunnels("platforms--example-firewall", {
        "ipsec-branch-1": {
            ...TUNNEL,
            addresses: ["10.255.12.1/30", "2001:db8:ffee::1/64"],
            local_address: "203.0.113.99",
            ike: { encryption: "aes-256-cbc", integrity: "hmac-sha2-256-128", prf: "hmac-sha2-512", dh_group: 14, lifetime: 60 },
        },
    });

    expect(fortios.unsupported(device)).toEqual(
        expect.arrayContaining([
            "interfaces.ipsec.ipsec-branch-1.local_address, no interface holds 203.0.113.99",
            "interfaces.ipsec.ipsec-branch-1.ike.prf hmac-sha2-512 with integrity hmac-sha2-256-128: the platform uses one hash for both",
            "interfaces.ipsec.ipsec-branch-1.ike.lifetime 60, the platform takes 120 to 172800",
            "interfaces.ipsec.ipsec-branch-1.addresses, an IPv4 address on a tunnel takes its peer",
            "interfaces.ipsec.ipsec-branch-1.addresses, IPv6 in the tunnel, which is not built yet",
        ])
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
        "interfaces.ipsec.ipsec-branch-1, which RouterOS has only from 7.25, where it cut a router off in a test (TRAPS.md)"
    );
});
