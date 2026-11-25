// IPsec remote access on FortiOS (decision 227), as a FG-3700D on FortiOS 6.2.2 took it in a test VDOM.

import { expect, test } from "bun:test";
import type { Device, IpsecRemoteAccess } from "../../src/model";
import { FortiOs } from "../../src/platforms/fortios";
import { Fixtures } from "../fixtures";

const platform = new FortiOs();
// Its certificate's file stands in for both, from the fixtures' folder.
const pem = Object.values(Fixtures.device("platforms--example-firewall").system?.certificates ?? {})[0]!.certificate_file;
const options = { secrets: false, rollback: 10 };

const access: IpsecRemoteAccess = {
    description: "Laptops",
    local_address: "203.0.113.2",
    pool: ["198.51.100.100", "198.51.100.110"],
    dns: ["198.51.100.53"],
    traffic_selectors: [{ local_prefix: "198.51.100.0/26" }],
    ike: { encryption: "aes-256-cbc", integrity: "hmac-sha2-256-128", prf: "hmac-sha2-256", dh_group: 19, lifetime: 86_400 },
    esp: { encryption: "aes-256-cbc", integrity: "hmac-sha2-256-128", lifetime: 43_200 },
    certificate: "vpn",
    ca_certificate: "users-ca",
};

const firewall: Device = {
    name: "fw-01",
    site: "lab",
    platform: "fortios",
    model: "FG-3700D",
    connection: { host: "127.0.0.1", user: "netops" },
    system: {
        users: { netops: { role: "admin", password: { secret: "EXAMPLE_NETOPS_PASSWORD" } } },
        certificates: {
            vpn: { certificate_file: pem, private_key: { secret: "EXAMPLE_VPN_KEY" } },
            "users-ca": { certificate_file: pem },
        },
    },
    management: { allow: ["192.0.2.0/24"], ssh: {} },
    interfaces: {
        ethernet: {
            "10g-1": { description: "Upstream", addresses: ["203.0.113.2/30"] },
            "10g-2": { description: "Office", addresses: ["198.51.100.1/26"] },
        },
    },
    services: { ipsec_remote_access: { laptops: access } },
};

/** A section of the render, as `show` prints it. */
function section(rendered: string, name: string): string {
    return new RegExp(`^config ${name}\\n[\\s\\S]*?^end$`, "m").exec(rendered)?.[0] ?? "";
}

test("remote access with certificates is a dial-up phase 1 with mode-cfg, the peer of its CA, and a phase 2 for the selector", () => {
    const rendered = platform.render(firewall);

    expect(section(rendered, "vpn ipsec phase1-interface")).toBe(
        [
            "config vpn ipsec phase1-interface",
            '    edit "laptops"',
            "        set type dynamic",
            '        set interface "port5"',
            "        set ike-version 2",
            "        set local-gw 203.0.113.2",
            "        set authmethod signature",
            "        set peertype peer",
            "        set net-device disable",
            "        set mode-cfg enable",
            "        set ipv4-dns-server1 198.51.100.53",
            "        set proposal aes256-sha256",
            "        set dpd on-idle",
            "        set dhgrp 19",
            '        set certificate "vpn"',
            '        set peer "users-ca"',
            "        set ipv4-start-ip 198.51.100.100",
            "        set ipv4-end-ip 198.51.100.110",
            "        set dpd-retryinterval 60",
            '        set comments "Laptops"',
            "    next",
            "end",
        ].join("\n")
    );
    expect(section(rendered, "vpn ipsec phase2-interface")).toBe(
        [
            "config vpn ipsec phase2-interface",
            '    edit "laptops"',
            '        set phase1name "laptops"',
            "        set proposal aes256-sha256",
            "        set pfs disable",
            "        set src-subnet 198.51.100.0 255.255.255.192",
            "    next",
            "end",
        ].join("\n")
    );
    expect(section(rendered, "user peer")).toContain('    edit "users-ca"\n        set ca "users-ca"');
    expect(platform.unsupported(firewall)).toEqual([]);
    expect(platform.experimental(firewall)).toEqual([]);
});

test("remote access with EAP passes users to a RADIUS entry of its name, through a group of another name, and stays experimental", () => {
    const eap: Device = {
        ...firewall,
        services: {
            ipsec_remote_access: {
                laptops: {
                    ...access,
                    ca_certificate: undefined,
                    radius: [
                        { address: "192.0.2.10", secret_key: { secret: "EXAMPLE_RADIUS" } },
                        { address: "192.0.2.11", secret_key: { secret: "EXAMPLE_RADIUS" } },
                    ],
                },
            },
        },
    };
    const rendered = platform.render(eap);

    expect(section(rendered, "vpn ipsec phase1-interface")).toContain(
        '        set peertype any\n        set net-device disable\n        set mode-cfg enable\n        set ipv4-dns-server1 198.51.100.53\n        set proposal aes256-sha256\n        set dpd on-idle\n        set dhgrp 19\n        set eap enable\n        set eap-identity send-request\n        set authusrgrp "laptops-users"\n        set certificate "vpn"'
    );
    const radius = section(rendered, "user radius");
    expect(radius).toContain('    edit "laptops"\n        set server "192.0.2.10"');
    expect(radius).toContain('        set secondary-server "192.0.2.11"');
    expect(radius).toContain(
        '        config accounting-server\n            edit 1\n                set status enable\n                set server "192.0.2.10"'
    );
    expect(section(rendered, "user group")).toContain('    edit "laptops-users"\n        set member "laptops"');
    expect(platform.unsupported(eap)).toEqual([]);
    expect(platform.experimental(eap)).toEqual(["services.ipsec_remote_access.laptops.radius"]);
});

test("FortiOS refuses what it can't hold, or no FortiGate tried", () => {
    const refused = (changes: Partial<IpsecRemoteAccess>, name = "laptops") =>
        platform
            .unsupported({ ...firewall, services: { ipsec_remote_access: { [name]: { ...access, ...changes } as IpsecRemoteAccess } } })
            .filter((gap) => gap.startsWith("services.ipsec_remote_access"));

    expect(refused({ traffic_selectors: [{ local_prefix: "198.51.100.0/27" }, { local_prefix: "198.51.100.32/27" }] })).toEqual([
        "services.ipsec_remote_access.laptops.traffic_selectors holds 2: one was tested on FortiOS. Write one prefix that holds them",
    ]);
    expect(refused({ dns: ["192.0.2.53", "192.0.2.54", "192.0.2.55", "192.0.2.56"] })).toEqual([
        "services.ipsec_remote_access.laptops.dns, at most 3 on FortiOS",
    ]);
    expect(refused({}, "laptops-and-phones")).toEqual([
        "services.ipsec_remote_access.laptops-and-phones, a name of 15 characters at most: its phase 1 makes an interface of it",
    ]);
    expect(
        refused({
            ca_certificate: undefined,
            radius: [{ address: "192.0.2.10", secret_key: { secret: "EXAMPLE_RADIUS" }, acct_port: 1646 }],
        })
    ).toEqual([
        "services.ipsec_remote_access.laptops.radius[0].acct_port, FortiOS 6.2.2 leaves an accounting server's port out of show at times, so the plan would never settle: leave it out for 1813",
    ]);
});

test("a remote access goes before the peer of its CA is deleted", () => {
    const rendered = platform.render(firewall);
    const bare = platform.render({ ...firewall, services: undefined });
    const titles = platform.plan(bare, rendered, options).steps.map((step) => step.title);

    expect(titles.indexOf("vpn ipsec phase1-interface, removed")).toBeLessThan(titles.indexOf("user peer, removed"));
    expect(titles.indexOf("vpn ipsec phase2-interface, removed")).toBeLessThan(titles.indexOf("vpn ipsec phase1-interface, removed"));
});
