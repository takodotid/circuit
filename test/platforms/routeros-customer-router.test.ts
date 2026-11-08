// A customer's router on an RB5009: its uplink takes an address by DHCP, a tunnel to the data centre is tied to that uplink, a LAG of
// tunnels keeps one MAC, consoles open ports by UPnP, and its LAN gets router advertisements. Each printed line below is how an RB5009
// on RouterOS 7.24.6 printed what the render writes, so a device that runs the config plans nothing.

import { expect, test } from "bun:test";
import type { Device } from "../../src/model";
import { Platforms } from "../../src/platforms";
import { Derive } from "../../src/platforms/derive";
import { RouterOsExport } from "../../src/platforms/routeros/export";

const adapter = Platforms.get("routeros");
const options = { secrets: false, rollback: 10 };

const router: Device = {
    name: "cpe-01",
    site: "home",
    platform: "routeros",
    model: "RB5009UG+S+",
    connection: { host: "192.168.77.1", user: "admin" },
    switching: { vlans: { lan: { id: 77 } } },
    interfaces: {
        ethernet: {
            "1g-1": {
                description: "Uplink",
                dhcp_client: { default_routes: [{ routing_table: "wan1", distance: 1 }, { distance: 200 }] },
                shaping: { algorithm: "cake", mbps: 90 },
            },
            "1g-3": { access_vlan: "lan" },
            "1g-4": { access_vlan: "lan" },
        },
        vlan_interface: { lan: { vlan: "lan", addresses: ["192.168.77.1/24", "2001:db8:1::1/64"], ipv6_ra: true } },
        loopback: { public: { addresses: ["203.0.113.81/32"] } },
        wireguard: {
            wg1: {
                listen_port: 51811,
                routing_table: "wan1",
                private_key: { secret: "WG1_KEY" },
                addresses: ["10.80.1.2/30"],
                peers: [
                    {
                        name: "dc",
                        public_key: "dc-key",
                        allowed_addresses: ["10.80.1.1/32"],
                        endpoint: "198.51.100.1:51822",
                        keepalive: 25,
                    },
                ],
            },
        },
        eoip: { eoip1: { local_address: "10.80.1.2", remote_address: "10.80.1.1", tunnel_id: 101, mtu: 1378, in_lag: "lag1" } },
        lag: {
            lag1: {
                mode: "round_robin",
                link_check: { arp_targets: ["10.81.1.1"], interval_ms: 200 },
                mac: "02:00:00:6b:31:01",
                mtu: 1378,
                addresses: ["10.81.1.2/30"],
            },
        },
    },
    routing: {
        tables: { wan1: {} },
        static_routes: [{ prefix: "0.0.0.0/0", blackhole: true, distance: 254, routing_table: "wan1" }],
    },
    services: { upnp: { internal: ["lan"], external: "lag1", external_address: "203.0.113.81" } },
    firewall: {
        filter: {
            forward: {
                default_action: "drop",
                rules: [
                    { if: { connection_state: ["established", "related"] }, then: "accept" },
                    { description: "opened by UPnP", if: { connection_nat_state: ["dstnat"] }, then: "accept" },
                ],
            },
        },
    },
};

const rendered = adapter.render(router);

test("the render writes each new field as the platform takes it", () => {
    expect(adapter.unsupported(router)).toEqual([]);
    expect(rendered).toContain('add default-route-tables="wan1:1,main:200" interface=ether2 name=ether2 use-peer-dns=no use-peer-ntp=no');
    expect(rendered).toContain("forced-mac-address=02:00:00:6B:31:01");
    expect(rendered).toContain(
        'add action=mark-routing chain=output comment="wg1 by wan1" new-routing-mark=wan1 passthrough=no protocol=udp src-port=51811'
    );
    expect(rendered).toContain(
        'add action=mark-packet chain=postrouting comment="Shaping of ether2" new-packet-mark=ether2-cake out-interface=ether2'
    );
    expect(rendered).toContain("set [ find default=yes ] disabled=yes");
    expect(rendered).toContain("add interface=lan");
    expect(rendered).toContain("/ip upnp\nset enabled=yes");
    expect(rendered).toContain("add forced-ip=203.0.113.81 interface=lag1 type=external");
    expect(rendered).toContain("add interface=lan type=internal");
    expect(rendered).toContain('add action=accept chain=forward comment="opened by UPnP" connection-nat-state=dstnat');
});

test("a device that prints what the render wrote plans nothing for it", () => {
    const printed = [
        "/ip dhcp-client",
        "add default-route-tables=wan1:1,main:200 interface=ether2 name=ether2 use-peer-dns=no use-peer-ntp=no",
        "/ipv6 nd",
        "set [ find default=yes ] advertise-dns=yes disabled=yes",
        "add interface=lan",
        "/ip upnp",
        "set enabled=yes",
        "/ip upnp interfaces",
        "add interface=lan type=internal",
        "add forced-ip=203.0.113.81 interface=lag1 type=external",
    ].join("\n");
    const menus = new Set(["/ip dhcp-client", "/ipv6 nd", "/ip upnp", "/ip upnp interfaces"]);

    const plan = adapter.plan(rendered, printed, options);
    expect(plan.problems).toEqual([]);
    expect(plan.steps.filter((step) => menus.has(step.title))).toEqual([]);
});

// The client a person made by hand, with a script and another name, is changed in place: a second client on its interface is refused.
test("a DHCP client made by hand is changed in place, by its interface", () => {
    const printed = [
        "/ip dhcp-client",
        'add comment="WAN-1" default-route-tables=wan1:1,main:200 interface=ether2 name=wan1-dhcp script=":log info bound" use-peer-dns=no use-peer-ntp=no',
    ].join("\n");

    const plan = adapter.plan(rendered, printed, options);
    expect(plan.problems).toEqual([]);
    const sent = plan.steps.filter((step) => step.title === "/ip dhcp-client").flatMap((step) => step.send);
    expect(sent).toEqual(['/ip dhcp-client set [ find interface=ether2 ] name=ether2 comment="" script=""']);
});

test("an empty list of default routes adds none", () => {
    const none: Device = {
        ...router,
        interfaces: { ...router.interfaces, ethernet: { ...router.interfaces?.ethernet, "1g-1": { dhcp_client: { default_routes: [] } } } },
    };
    expect(adapter.render(none)).toContain("add add-default-route=no interface=ether2 name=ether2 use-peer-dns=no use-peer-ntp=no");
});

test("a platform that does not build them refuses each new field by name", () => {
    expect(Derive.unbuilt(router)).toEqual(
        expect.arrayContaining([
            "interfaces.ethernet.1g-1.dhcp_client, which the platform does not build",
            "interfaces.ethernet.1g-1.shaping, which the platform does not build",
            "interfaces.lag.lag1.mac, which the platform does not build",
            "interfaces.wireguard.wg1.routing_table, which the platform does not build",
            "services.upnp, which the platform does not build",
            "firewall.filter.forward.rules[1].if.connection_nat_state, which the platform does not build",
        ])
    );
});

// A disabled route in the main table has no table at all: `find routing-table=main` matched nothing, and the change was never made.
test("a disabled route in the main table is found by a selector that allows no table", () => {
    const printed = [
        "/ip route",
        "add comment=old disabled=yes distance=1 dst-address=0.0.0.0/0 gateway=10.101.3.1 pref-src=203.0.113.60",
    ].join("\n");
    const desired = ["/ip route", "add dst-address=0.0.0.0/0 gateway=10.81.1.1"].join("\n");

    const sent = adapter.plan(desired, printed, options).steps.flatMap((step) => step.send);
    expect(sent).toEqual([
        '/ip route set [ find dst-address="0.0.0.0/0" and (routing-table=main or !routing-table) and !dynamic ] gateway=10.81.1.1 comment="" disabled=no pref-src=""',
    ]);
});

// With a key, RouterOS refuses the user's password over SSH unless told otherwise, and Circuit logs in by password.
test("a user with a key keeps logging in by password", () => {
    expect(rendered).not.toContain("password-authentication");
    const keyed: Device = {
        ...router,
        system: { users: { admin: { role: "admin", password: { secret: "PASSWORD" }, ssh_keys: ["ssh-ed25519 AAAA test"] } } },
    };
    expect(adapter.render(keyed)).toContain("/ip ssh\nset password-authentication=yes strong-crypto=yes");
});

// RouterOS never prints a key, only its fingerprint, and `/user export` leaves keys out: they are read by fingerprint and compared so.
test("an SSH key the device holds plans nothing, and another is replaced", () => {
    const key = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGVzc2VudGlhbGx5IGFuIGV4YW1wbGUga2V5IG9ubHk= test";
    const desired = ["/user ssh-keys", `add key="${key}" user=admin`].join("\n");
    const held = ["/user ssh-keys", `add fingerprint=${RouterOsExport.fingerprint(key)} user=admin`].join("\n");
    expect(adapter.plan(desired, held, options).steps).toEqual([]);

    const other = ["/user ssh-keys", "add fingerprint=SHA256:b3RoZXIga2V5IGZpbmdlcnByaW50IGhlcmUgb2s= user=admin"].join("\n");
    const sent = adapter.plan(desired, other, options).steps.flatMap((step) => step.send);
    expect(sent).toEqual([
        `/user ssh-keys add key="${key}" user=admin`,
        '/user ssh-keys remove [ find user=admin and fingerprint="SHA256:b3RoZXIga2V5IGZpbmdlcnByaW50IGhlcmUgb2s=" ]',
    ]);
});
