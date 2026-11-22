// IPsec remote access, `services.ipsec_remote_access`. RouterOS was proven on a CHR with 7.24.6, with strongSwan as the laptop (test/platforms/routeros-chr-remote-access.test.ts). The other platforms refuse it.

import { expect, test } from "bun:test";
import { Checks } from "../../src/checks";
import type { Device, IpsecRemoteAccess, PolicyIpsec } from "../../src/model";
import { Platforms } from "../../src/platforms";
import { Fixtures } from "../fixtures";

/** Remote access on the router fixture's uplink, to its servers, whose users log in with EAP. */
const ACCESS: IpsecRemoteAccess = {
    description: "Staff laptops",
    local_address: "203.0.113.2",
    pool: ["203.0.113.130", "203.0.113.140"],
    dns: ["198.51.100.53", "198.51.100.54"],
    traffic_selectors: [{ local_prefix: "198.51.100.64/26" }],
    certificate: "web",
    radius: [{ address: "198.51.100.70", secret_key: { secret: "RADIUS_KEY" } }],
    ike: { encryption: "aes-256-cbc", integrity: "hmac-sha2-256-128", prf: "hmac-sha2-256", dh_group: 14, lifetime: 28800 },
    esp: { encryption: "aes-256-cbc", integrity: "hmac-sha2-256-128", lifetime: 3600 },
};

/** A fixture's device with this remote access, and a CA for users' certificates: any certificate file, as the render reads only its fingerprint. */
function withAccess(fixture: string, access: Record<string, IpsecRemoteAccess>): Device {
    const device = Fixtures.device(fixture);
    const ca = { certificate_file: "platforms--example-router.web.pem" };
    return {
        ...device,
        system: { ...device.system, certificates: { ...device.system?.certificates, "staff-ca": ca } },
        services: { ...device.services, ipsec_remote_access: access },
    };
}

const routeros = Platforms.get("routeros");
const options = { secrets: false, rollback: 10 };
const messages = (device: Device) => Checks.run([device], undefined).map((finding) => finding.message);

test("RouterOS writes a pool, a profile, a proposal, a mode config, a policy group, a passive peer, and an identity of the entry's name, a template for each selector and prefix of the pool, and the RADIUS servers", () => {
    const desired = routeros.render(withAccess("platforms--example-router", { staff: ACCESS }));

    expect(desired).toContain("add name=staff ranges=203.0.113.130-203.0.113.140\n");
    expect(desired).toContain(`/ip ipsec profile
add dh-group=modp2048 enc-algorithm=aes-256 hash-algorithm=sha256 lifetime=8h name=staff prf-algorithm=sha256
/ip ipsec proposal
add auth-algorithms=sha256 enc-algorithms=aes-256-cbc lifetime=1h name=staff pfs-group=none
/ip ipsec mode-config
add address-pool=staff address-prefix-length=32 name=staff split-include=198.51.100.64/26 static-dns="198.51.100.53,198.51.100.54" system-dns=no
/ip ipsec policy group
add name=staff
/ip ipsec policy
add dst-address=203.0.113.130/31 group=staff proposal=staff src-address=198.51.100.64/26 template=yes
add dst-address=203.0.113.132/30 group=staff proposal=staff src-address=198.51.100.64/26 template=yes
add dst-address=203.0.113.136/30 group=staff proposal=staff src-address=198.51.100.64/26 template=yes
add dst-address=203.0.113.140/32 group=staff proposal=staff src-address=198.51.100.64/26 template=yes
/ip ipsec peer
add comment="Staff laptops" exchange-mode=ike2 local-address=203.0.113.2 name=staff passive=yes profile=staff
/ip ipsec identity
add auth-method=eap-radius certificate=web generate-policy=port-strict mode-config=staff peer=staff policy-template-group=staff
`);
    expect(desired).toContain('add address=198.51.100.70 secret="<secret:RADIUS_KEY>" service=ipsec');
    expect(routeros.plan(desired, desired, options)).toEqual({ steps: [], problems: [] });
});

test("RouterOS takes users' certificates as a digital signature, and gives no DNS servers without dns", () => {
    const access = { ...ACCESS, radius: undefined, ca_certificate: "staff-ca", dns: undefined } as IpsecRemoteAccess;
    const desired = routeros.render(withAccess("platforms--example-router", { staff: access }));

    expect(desired).toContain("add address-pool=staff address-prefix-length=32 name=staff split-include=198.51.100.64/26 system-dns=no\n");
    expect(desired).toContain(
        "add auth-method=digital-signature certificate=web generate-policy=port-strict mode-config=staff peer=staff policy-template-group=staff"
    );
    expect(desired).not.toContain("service=ipsec");
    expect(routeros.plan(desired, desired, options).steps).toEqual([]);
});

test("RouterOS adds the entries in order, and removes them in the reverse order", () => {
    const without = routeros.render(withAccess("platforms--example-router", {}));
    const withAccessRender = routeros.render(withAccess("platforms--example-router", { staff: ACCESS }));

    const menus = (desired: string, current: string) =>
        routeros
            .plan(desired, current, options)
            .steps.map((step) => step.title)
            .filter((title) => title.startsWith("/ip ipsec") || title.startsWith("/ip pool"));
    expect(menus(withAccessRender, without)).toEqual([
        "/ip pool",
        "/ip ipsec profile",
        "/ip ipsec proposal",
        "/ip ipsec mode-config",
        "/ip ipsec policy group",
        "/ip ipsec peer",
        "/ip ipsec identity",
        "/ip ipsec policy",
    ]);
    expect(menus(without, withAccessRender)).toEqual([
        "/ip ipsec policy",
        "/ip ipsec identity",
        "/ip ipsec peer",
        "/ip ipsec policy group",
        "/ip ipsec mode-config",
        "/ip ipsec proposal",
        "/ip ipsec profile",
        "/ip pool",
    ]);
});

test("RouterOS refuses a second remote access, a fast path, a name it takes for its own entries or another's, two selectors, AES-GCM in IKE, an address in a VRF, and a CA beside another", () => {
    const device = withAccess("platforms--example-router", {
        default: {
            ...ACCESS,
            traffic_selectors: [{ local_prefix: "198.51.100.64/26" }, { local_prefix: "192.0.2.0/24" }],
            ike: { encryption: "aes-256-gcm", prf: "hmac-sha2-256", dh_group: 19, lifetime: 86400 },
        },
        "branch-1": {
            ...ACCESS,
            local_address: "198.51.100.129",
            pool: ["203.0.113.150", "203.0.113.160"],
            radius: undefined,
            ca_certificate: "staff-ca",
        } as IpsecRemoteAccess,
    });
    const tunnel: PolicyIpsec = {
        local_address: "203.0.113.2",
        remote_address: "192.0.2.30",
        traffic_selectors: [{ local_prefix: "198.51.100.0/30", remote_prefix: "192.0.2.128/25" }],
        pre_shared_key: { secret: "IPSEC_KEY" },
        ike: ACCESS.ike,
        esp: ACCESS.esp,
    };
    device.firewall = { ...device.firewall, ipsec: { "branch-1": tunnel } };
    device.system = {
        ...device.system,
        certificates: { ...device.system?.certificates, "syslog-ca": { certificate_file: "ca.pem" } },
    };

    expect(routeros.unsupported(device)).toEqual(
        expect.arrayContaining([
            "services.ipsec_remote_access.branch-1: Circuit runs one remote access on a RouterOS router, as tested. Write one",
            "services.ipsec_remote_access beside a fast_path rule, whose flows skip IPsec's policies: take fast_path off",
            "services.ipsec_remote_access.default: the name of an IPsec entry RouterOS has itself, which the remote access's take. Write another name",
            "services.ipsec_remote_access.default.traffic_selectors holds 2: RouterOS narrows a client that asks for all its traffic to the first alone (TRAPS.md). Write one prefix that holds them",
            "services.ipsec_remote_access.default.ike.encryption aes-256-gcm: RouterOS's IKE has no AES-GCM. Write aes-128-cbc or aes-256-cbc, with integrity",
            "services.ipsec_remote_access.branch-1, named as firewall.ipsec.branch-1: RouterOS names the IPsec entries of each after it. Give each its own name",
            "services.ipsec_remote_access.branch-1.local_address 198.51.100.129, on interfaces.vlan_interface.guests in VRF guests: RouterOS runs IKE in the main table only (TRAPS.md)",
            "services.ipsec_remote_access.branch-1.ca_certificate staff-ca: RouterOS takes a peer's certificate that any certificate it holds signed, and it holds syslog-ca too. Keep staff-ca the only certificate without a private key",
        ])
    );
});

test("Junos, VRP, and Raisecom ROS refuse remote access, since the switches don't encrypt what they forward, and FortiOS hasn't built it yet", () => {
    for (const fixture of ["platforms--example-aggregation-switch", "platforms--example-switch", "platforms--example-core-switch"]) {
        const device = withAccess(fixture, { staff: ACCESS });
        expect(Platforms.get(device.platform).unsupported(device)).toContainEqual(
            expect.stringMatching(/^services\.ipsec_remote_access, IPsec: .* does not encrypt the traffic it forwards$/)
        );
    }

    const firewall = withAccess("platforms--example-firewall", { staff: ACCESS });
    expect(Platforms.get("fortios").unsupported(firewall)).toContain(
        "services.ipsec_remote_access, IPsec remote access, not built yet for FortiOS"
    );
});

test("validate takes a pool of IPv4 addresses without the gateway's, whole IPv4 selectors, and RADIUS or a CA, one of the two", () => {
    const device = withAccess("platforms--example-router", {
        staff: {
            ...ACCESS,
            pool: ["203.0.113.140", "203.0.113.130"],
            dns: ["2001:db8::53"],
            traffic_selectors: [{ local_prefix: "198.51.100.65/26" }, { local_prefix: "2001:db8::/32" }],
            ca_certificate: "staff-ca",
        } as unknown as IpsecRemoteAccess,
        guests: { ...ACCESS, pool: ["203.0.113.1", "203.0.113.9"], traffic_selectors: [], radius: [] },
    });

    expect(messages(device)).toEqual(
        expect.arrayContaining([
            "services.ipsec_remote_access.staff.pool starts at 203.0.113.140, after its last address 203.0.113.130",
            "services.ipsec_remote_access.staff.dns: '2001:db8::53' is not an IPv4 address, such as 192.0.2.1",
            "services.ipsec_remote_access.staff.traffic_selectors[0].local_prefix 198.51.100.65/26 has bits past its length: write 198.51.100.64/26",
            "services.ipsec_remote_access.staff.traffic_selectors[1].local_prefix: '2001:db8::/32' is not an IPv4 prefix with its length, such as 198.51.100.0/24",
            "services.ipsec_remote_access.staff: write radius, for users who log in with EAP, or ca_certificate, for users with certificates",
            "services.ipsec_remote_access.guests.local_address 203.0.113.2 is in pool: write a pool without it",
            "services.ipsec_remote_access.guests.traffic_selectors is empty: write the local_prefix of each network clients reach",
            "services.ipsec_remote_access.guests.radius is empty: write the RADIUS servers that check users",
        ])
    );
});

test("validate refuses a pool that a policy-based tunnel's remote prefix holds, for the same local prefix", () => {
    const device = withAccess("platforms--example-router", { staff: ACCESS });
    device.firewall = {
        ...device.firewall,
        ipsec: {
            "branch-1": {
                local_address: "203.0.113.2",
                remote_address: "192.0.2.30",
                traffic_selectors: [{ local_prefix: "198.51.100.64/27", remote_prefix: "203.0.113.128/25" }],
                pre_shared_key: { secret: "IPSEC_KEY" },
                ike: ACCESS.ike,
                esp: ACCESS.esp,
            },
        },
    };

    expect(messages(device)).toContain(
        "services.ipsec_remote_access.staff: clients from pool reach 198.51.100.64/26, and firewall.ipsec.branch-1 takes traffic from 198.51.100.64/27 to 203.0.113.128/25 too. Give the pool addresses outside 203.0.113.128/25"
    );
});
