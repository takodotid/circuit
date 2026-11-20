// Tested on a CCR2216 (RouterOS 7.24.6), a QFX5100 (Junos 21.4R3), and a FG-3700D (FortiOS 6.2.2, multi-VDOM). The plan's lines were sent, the device's own user logged in again, and the next plan was empty. The lines that take them away were sent too. The adapters get what each device printed.

import { expect, test } from "bun:test";
import type { Device } from "../../src/model";
import type { Aaa } from "../../src/config/system";
import { Platforms } from "../../src/platforms";
import { Fixtures } from "../fixtures";

const options = { secrets: false, rollback: 10 };
const key = { secret: "AAA_KEY" } as const;

const sent = (platform: string, desired: string, current: string, secrets = false) =>
    Platforms.get(platform)
        .plan(desired, current, { ...options, secrets })
        .steps.flatMap((step) => step.send);

function withAaa(device: Device, aaa: Aaa | undefined): Device {
    return { ...device, system: { ...device.system, aaa } };
}

const radius: Aaa = {
    radius: [
        { address: "192.0.2.10", secret_key: key, auth_port: 1812, acct_port: 1813 },
        { address: "192.0.2.11", secret_key: key, source_address: "10.99.0.1" },
    ],
    remote_role: "read-only",
    accounting_events: ["login"],
};

const tacacs: Aaa = {
    tacacs: [
        { address: "192.0.2.10", secret_key: key },
        { address: "192.0.2.11", secret_key: key, source_address: "10.99.0.18" },
    ],
    remote_role: "read-only",
    accounting_events: ["login", "command"],
};

test("RouterOS asks RADIUS servers in order for logins, gives every remote user the default group, and plans nothing against what it printed", () => {
    const routeros = Platforms.get("routeros");
    const device = withAaa(Fixtures.device("edge-router--edge-01"), radius);
    const without = routeros.render(withAaa(device, undefined));
    const desired = routeros.render(device);

    expect(sent("routeros", desired, without).filter((line) => /radius|user aaa/.test(line))).toEqual([
        ":global frameworkOldRules [/radius find]",
        '/radius add accounting-port=1813 address=192.0.2.10 authentication-port=1812 secret="<secret:AAA_KEY>" service=login',
        '/radius add address=192.0.2.11 secret="<secret:AAA_KEY>" service=login src-address=10.99.0.1',
        ':global frameworkOldRules; /radius remove $frameworkOldRules; /system script environment remove [find name="frameworkOldRules"]',
        "/user aaa set exclude-groups=full,read,write use-radius=yes",
    ]);

    const printed = `${without}/radius
add address=192.0.2.10 service=login
add address=192.0.2.11 service=login src-address=10.99.0.1
/user aaa
set exclude-groups=full,read,write use-radius=yes
`;
    expect(sent("routeros", desired, printed)).toEqual([]);
    expect(sent("routeros", desired, printed, true)).toContain(
        '/radius add address=192.0.2.11 secret="<secret:AAA_KEY>" service=login src-address=10.99.0.1'
    );

    expect(sent("routeros", without, printed)).toEqual([
        ":global frameworkOldRules [/radius find]",
        ':global frameworkOldRules; /radius remove $frameworkOldRules; /system script environment remove [find name="frameworkOldRules"]',
        '/user aaa set exclude-groups="" use-radius=no',
    ]);

    const both = withAaa(device, { ...tacacs, radius: undefined });
    expect(routeros.unsupported(both)).toEqual(
        expect.arrayContaining([
            "system.aaa.tacacs, the platform logs in with RADIUS only",
            "system.aaa.accounting_events command, the platform sends a server its logins only",
        ])
    );
});

test("Junos checks its own users first, then the servers, as the template user remote, and plans nothing against what it printed", () => {
    const junos = Platforms.get("junos");
    const device = withAaa(Fixtures.device("platforms--example-aggregation-switch"), tacacs);
    const without = junos.render(withAaa(device, undefined));
    const desired = junos.render(device);

    const lines = [
        "set system login user remote class read-only",
        "set system authentication-order password",
        "set system authentication-order tacplus",
        "set system tacplus-server 192.0.2.10 secret <secret:AAA_KEY>",
        "set system tacplus-server 192.0.2.11 secret <secret:AAA_KEY>",
        "set system tacplus-server 192.0.2.11 source-address 10.99.0.18",
        "set system accounting events login",
        "set system accounting events interactive-commands",
        "set system accounting destination tacplus",
    ];
    expect(sent("junos", desired, without)).toEqual(lines);

    // As `show configuration | display set` printed them, the secrets redacted by the read.
    const printed = `${without}set system login user remote uid 2001
set system login user remote class read-only
set system authentication-order password
set system authentication-order tacplus
set system tacplus-server 192.0.2.10 secret <redacted>
set system tacplus-server 192.0.2.11 secret <redacted>
set system tacplus-server 192.0.2.11 source-address 10.99.0.18
set system accounting events login
set system accounting events interactive-commands
set system accounting destination tacplus
`;
    expect(sent("junos", desired, printed)).toEqual([]);
    expect(sent("junos", without, printed)).toEqual([
        "delete system login user remote",
        "delete system authentication-order",
        "delete system tacplus-server",
        "delete system accounting",
    ]);

    const reordered = printed.replace(
        "set system authentication-order password\nset system authentication-order tacplus",
        "set system authentication-order tacplus\nset system authentication-order password"
    );
    expect(sent("junos", desired, reordered)).toEqual([
        "delete system authentication-order",
        "set system authentication-order password",
        "set system authentication-order tacplus",
    ]);

    const named = withAaa(
        { ...device, system: { ...device.system, users: { ...device.system?.users, remote: { role: "admin", password: key } } } },
        tacacs
    );
    expect(junos.unsupported(named)).toContain(
        "system.users.remote, with system.aaa the platform keeps the name for the users a server accepts"
    );
});

const firewall: Device = {
    name: "fw-01",
    site: "lab",
    platform: "fortios",
    model: "FG-3700D",
    connection: { host: "192.0.2.4", user: "netops" },
    system: {
        users: { netops: { role: "admin", password: { secret: "EXAMPLE_NETOPS_PASSWORD" } } },
        vdoms: { management: { name: "mgmt", interfaces: ["1g-1"] } },
    },
    management: { allow: ["192.0.2.0/24"], ssh: {} },
    interfaces: {
        ethernet: {
            "1g-1": { description: "Out-of-band", addresses: ["192.0.2.4/24"] },
            "10g-1": { description: "Upstream", addresses: ["203.0.113.2/30"] },
        },
    },
};

test("FortiOS puts the servers in one entry, makes a wildcard administrator after the group in root, and removes it first", () => {
    const fortios = Platforms.get("fortios");
    const aaa: Aaa = { tacacs: tacacs.tacacs!.map((server) => ({ ...server, source_address: "203.0.113.2" })), remote_role: "read-only" };
    const device = withAaa(firewall, aaa);
    const without = fortios.render(withAaa(device, undefined));
    const desired = fortios.render(device);

    const titles = (desiredText: string, current: string) => fortios.plan(desiredText, current, options).steps.map((step) => step.title);
    expect(titles(desired, without)).toEqual(["system accprofile", "root: user tacacs+", "root: user group", "system admin"]);
    expect(titles(without, desired)).toEqual([
        "system admin, removed",
        "root: user group, removed",
        "root: user tacacs+, removed",
        "system accprofile, removed",
    ]);

    // As `show user tacacs+` printed it, the keys redacted by the read.
    const printed = desired.replace(
        /config user tacacs\+\n[\s\S]*?\nend\n/,
        `config user tacacs+
    edit "circuit-tacacs"
        set server "192.0.2.10"
        set secondary-server "192.0.2.11"
        set key ENC <redacted>
        set secondary-key ENC <redacted>
        set source-ip "203.0.113.2"
    next
end
`
    );
    expect(sent("fortios", desired, printed)).toEqual([]);

    const tooMany: Aaa = {
        radius: ["192.0.2.10", "192.0.2.11", "192.0.2.12", "192.0.2.13"].map((address, index) => ({
            address: address as `${number}.${number}.${number}.${number}`,
            secret_key: key,
            auth_port: 1812 + index,
            acct_port: 1813,
            ...(index ? {} : { source_address: "203.0.113.2" as const }),
        })),
        remote_role: "operator",
        accounting_events: ["login"],
    };
    expect(fortios.unsupported(withAaa(firewall, tooMany))).toEqual(
        expect.arrayContaining([
            "system.aaa.accounting_events, FortiOS 6.2 sends no accounting for administrators",
            "system.aaa.radius, more than 3 servers: the platform asks at most 3",
            "system.aaa.radius source_address, the platform sends to every server from one address: write the same on each",
            "system.aaa.radius auth_port, the platform sends to every server on one port: write the same on each",
            "system.aaa.radius[0].acct_port, FortiOS 6.2 sends no accounting for administrators",
        ])
    );
});

test("Raisecom ROS refuses logins through servers, as it has no role for a user a server accepts", () => {
    const device = { ...withAaa(Fixtures.device("platforms--example-switch"), tacacs), platform: "raisecom-ros" } as Device;
    expect(Platforms.get("raisecom-ros").unsupported(device)).toContain(
        "system.aaa, the platform has no setting for the role of a user a server accepts"
    );
});
