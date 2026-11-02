# Write a project

A project is a folder of TypeScript files that describe one network: one file per device, plus the facts several devices share. It is plain data. It imports nothing from Circuit, and needs no npm and no Node: Circuit's functions are globals, and the editor reads their types from `.circuit/types`.

The examples on these pages make one whole project, a router and a switch at one site with one tenant. It passes `tsc` and `circuit validate` as written. More whole projects are in [Example projects](/guide/examples).

## Layout

```
circuit.ts                  the network: its AS, prefixes, communities, sites and checks
sites/site-a/site.ts        what more than one device at site-a writes
sites/site-a/edge-01.ts     one device per file
sites/site-a/switch-01.ts
tenants/tenant-a.ts         what tenant A adds to each device
tenants/index.ts            every tenant, merged
lib/checks.ts               the network's own checks
```

Circuit imports `circuit.ts` first, then every `.ts` under `sites/`, at any depth, but `site.ts`. Each of those files is one device. `tenants/` and `lib/` are imported only by the files that use them. Any other folder is yours.

A value is written in the device it lands on. When more than one device writes it, it moves to the site's `site.ts`, or to `circuit.ts`. Write it in the device first; decide what to share after.

## The network

```ts
// circuit.ts
// The network, AS64500: what holds for all of it. Circuit reads this file first, then every device file under sites/.

import { neighborsDescribed } from "./lib/checks";

export const as64500 = circuit({
    asn: 64500,
    prefixes: {
        site_a: { v4_1: "203.0.113.0/24", v6_1: "2001:db8:100::/48" },
    },
    communities: {
        groups: { transit: { value: 1 }, exchange: { value: 2 }, customer: { value: 3 } },
        learned_from_group: { code: 1 },
        do_not_announce_to_as: { code: 100 },
        blackhole: { code: 666 },
    },
    sites: {
        "site-a": { description: "A colocation site: one router and one switch." },
    },
    checks: {
        exports_end_in_reject: true,
        imports_end_in_accept_or_reject: true,
        same_vlan_ids: true,
        neighbors_described: neighborsDescribed,
    },
});
```

- `asn` is the network's AS. A device's BGP runs it unless the device writes `routing.bgp.asn`.
- `prefixes` are the network's own, in groups you choose, each prefix with a name. A device uses one by name: `as64500.prefixes.site_a.v4_1`.
- `communities` is the network's BGP community scheme (see [Communities](/guide/communities)).
- `sites` is each site's `description`, and its `number` when a community tags routes by site. A site is only that: Circuit takes nothing from it into a device. Each device's `site` is one of these, and the editor suggests them.
- `checks` turns on Circuit's checks and names your own (see [Checks](/guide/checks)).

Name the network after its AS, as `as64500` here: the name then says which network a device file joins. For two networks, such as two ASes, write one `circuit()` each in `circuit.ts`, each exported under its own name, and each device file calls its own network's `device()`. One hostname in two networks is an error.

## A site

```ts
// sites/site-a/site.ts
// site-a: the facts more than one of its devices writes.

export const site_a = literal({
    timezone: "UTC",
    addresses: {
        management_lan: "192.0.2.0/25",
        gateway: "192.0.2.1/25",
        switch: "192.0.2.2/25",
    },
    vlans: {
        mgmt: { id: 99, description: "Management" },
    },
});
```

`literal` keeps each value as written. Without it the editor sees `"mgmt"` only as some text, and can't check it where a device uses it.

Write each address once, with its length, as an interface needs it. A field that names one host, such as a static route's `next_hop`, takes it as it is: Circuit writes the address alone there. A device takes a VLAN whole: `vlans: { mgmt: site_a.vlans.mgmt }`.

## A device

```ts
// sites/site-a/edge-01.ts
// edge-01, the router: one transit, the management LAN, and tenant A behind it.

import { as64500 } from "../../circuit";
import { tenants } from "../../tenants";
import { site_a } from "./site";

export default as64500.device({
    name: "edge-01",
    include: [tenants.parts],
    site: "site-a",
    role: "Router",
    platform: "routeros",
    model: "CCR2216-1G-12XS-2XQ",
    connection: { host: "192.0.2.1", user: "netops" },

    system: {
        timezone: site_a.timezone,
        users: { netops: { role: "admin", password: secret("EDGE_01_ADMIN_PASSWORD") } },
    },
    management: { allow: "management", ssh: {} },

    interfaces: {
        ethernet: {
            "25g-1": { description: "transit-a", addresses: ["198.51.100.2/30"] },
            "25g-2": { description: "switch-01 10GE1/0/1", trunk_vlans: ["mgmt"], link: { device: "switch-01", port: "10g-1" } },
        },
        vlan_interface: {
            mgmt: { vlan: "mgmt", addresses: [site_a.addresses.gateway] },
        },
    },
    switching: {
        vlans: { mgmt: site_a.vlans.mgmt },
    },

    routing: {
        static_routes: [{ prefix: as64500.prefixes.site_a.v4_1, blackhole: true, description: "Originate our IPv4 block" }],
        bgp: {
            originated_prefixes: [as64500.prefixes.site_a.v4_1],
            neighbors: {
                "transit-a": {
                    address: "198.51.100.1",
                    remote_as: 64501,
                    description: "transit-a",
                    role: "provider",
                    import_policy: "transit-import",
                    export_policy: "transit-export",
                    communities: { groups: ["transit"] },
                },
            },
        },
        prefix_sets: {
            ours: { prefixes: as64500.prefixes.site_a },
        },
        policies: {
            "transit-import": merge([
                presets.bgp_sanity,
                { if: { prefix_set: "ours" }, then: "reject" },
                { communities: "import" },
                { then: "accept" },
            ]),
            "transit-export": [{ communities: "export" }, { if: { prefix_set: "ours" }, then: "accept" }, { then: "reject" }],
        },
    },

    firewall: {
        address_sets: {
            management: [site_a.addresses.management_lan],
            "bgp-neighbors": bgpNeighbors(),
        },
        interface_sets: {
            uplinks: ["25g-1"],
        },
        filter: {
            input: {
                default_action: "drop",
                rules: [
                    { if: { connection_state: ["established", "related"] }, then: "accept" },
                    { if: { protocol: "icmp" }, then: "accept" },
                    {
                        description: "BGP",
                        if: { src_address_set: "bgp-neighbors", protocol: "tcp", dst_port: presets.ports.bgp },
                        then: "accept",
                    },
                    { description: "SSH", if: { src_address_set: "management", protocol: "tcp", dst_port: 22 }, then: "accept" },
                ],
            },
            forward: {
                rules: merge([
                    { if: { connection_state: ["established", "related"] }, then: "accept" },
                    tenants.rules.edge_forward,
                    {
                        description: "Nothing new in from the internet",
                        if: { in_interface_set: "uplinks", connection_state: ["new"] },
                        then: "drop",
                    },
                ]),
            },
        },
        nat: {
            source: [
                {
                    description: "Management to the internet",
                    if: { src: site_a.addresses.management_lan, out_interface_set: "uplinks" },
                    then: "masquerade",
                },
            ],
        },
    },
});
```

A device file is `export default <network>.device({...})`, one device per file.

1. `name` is the hostname. `include`, right after it, lists where the device takes parts from (see [Parts](/guide/parts)).
2. `site` is one of the network's sites. `role` is free text, such as `Router`.
3. `platform` picks the operating system: `routeros`, `vrp`, `raisecom-ros`, `junos` or `fortios`. `model` is one of the platform's models, and decides the port names.
4. `connection` is how Circuit logs in: `host`, and `user`, one of `system.users`. `host` is its own value, apart from any interface's address.
5. The rest is the device's groups: `system`, `management`, `monitoring`, `interfaces`, `switching`, `services`, `routing`, `firewall`. [The model](/reference/model) says what each holds. Hover a field in the editor to read its documentation.

A port is `<speed>-<position>`: `25g-1` to `25g-12`, `100g-1`, `100g-2` and `1g-1` on this router. The editor says `25g-13 is not a port of CCR2216-1G-12XS-2XQ`. Circuit prints a port as the platform does, such as `sfp28-2` for `25g-2` on RouterOS and `10GE1/0/1` for `10g-1` on VRP.

A field that refers to something takes only a name the device declares, itself or through its parts: a VLAN, an interface, an address set, a policy. The editor suggests them, and a wrong one is an error.

What a device doesn't write is removed from the device or set back to its default. A field is written only when it has a value: no `enabled: false`.

A `link` is written at both ends, each in its own device file. The port's `description` names the far end as printed there, `<far device> <far port>`, such as `switch-01 10GE1/0/1`. Circuit checks that the far end links back, and warns when the description doesn't name it. It never writes the description for you.

A secret is `secret("NAME")`: its value is in `.env`, encrypted, and read only when a command is sent to the device. `circuit env set NAME` adds one. See [Secrets](/guide/secrets).

The switch is shorter:

```ts
// sites/site-a/switch-01.ts
// switch-01: the management VLAN to the router, and tenant A's servers.

import { as64500 } from "../../circuit";
import { tenants } from "../../tenants";
import { site_a } from "./site";

export default as64500.device({
    name: "switch-01",
    include: [tenants.parts],
    site: "site-a",
    role: "Switch",
    platform: "vrp",
    model: "CE6855-48S6Q-HI",
    connection: { host: "192.0.2.2", user: "netops" },

    system: {
        timezone: site_a.timezone,
        users: { netops: { role: "admin", password: secret("SWITCH_01_ADMIN_PASSWORD") } },
    },
    management: { allow: [site_a.addresses.management_lan], ssh: {} },

    interfaces: {
        ethernet: {
            "10g-1": { description: "edge-01 sfp28-2", trunk_vlans: ["mgmt"], link: { device: "edge-01", port: "25g-2" } },
        },
        vlan_interface: {
            mgmt: { vlan: "mgmt", addresses: [site_a.addresses.switch] },
        },
    },
    switching: {
        vlans: { mgmt: site_a.vlans.mgmt },
        stp: { mode: "rstp" },
    },
    routing: {
        static_routes: [{ prefix: presets.default_routes.ipv4, next_hop: site_a.addresses.gateway }],
    },
});
```

## Globals

| Global                             | What                                                                                                                                      |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `circuit({...})`                   | A network. Its `device({...})` declares one device, in its own file.                                                                      |
| `part(kind, value)`                | A part written in one file and used in another: `"device"`, or a rule list: `"filter"`, `"nat"`, `"acl"`, `"policy"`, `"policy-routing"`. |
| `merge([...])`                     | Items made into one list or one map, by the field it lands in.                                                                            |
| `literal(value)`                   | A value kept exactly as written, so the editor checks it where it is used.                                                                |
| `secret(name)`, `secretFile(path)` | A value read when a device is applied, never kept in the project.                                                                         |
| `bgpNeighbors()`                   | An address set Circuit fills with every BGP neighbor address of the device.                                                               |
| `presets`                          | Values from public standards: `bogons` (RFC 6890), `rfc1918`, `default_routes`, `ports`, `bgp_sanity`, `bad_tcp_flags`, `udp_amplifiers`. |
| `address`                          | IP math for your own checks (RFC 4632, RFC 4291).                                                                                         |

Data is snake_case: fields, `presets`, your own variables. Functions are camelCase.
