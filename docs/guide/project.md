---
description: How a Circuit project is laid out, and what a network, a site, and a device file look like.
---

# Your first project

A project is a folder of files that describe your network. It has one file per device, plus files for what several devices share.

The files are TypeScript, but they read like data. You install nothing, because Circuit's functions are built in. Your editor reads their types from `.circuit/types`.

This page builds one small project: a router and a switch at one site. It passes `circuit validate` as written. Bigger projects are in [Example projects](/guide/examples).

## Layout

```
circuit.ts                  the network: its AS, prefixes, communities, sites and checks
sites/site-a/site.ts        what more than one device at site-a writes
sites/site-a/edge-01.ts     one device per file
sites/site-a/switch-01.ts
tenants/                    what each tenant adds to the devices, if you have tenants
lib/                        the network's own checks, if you write any
```

- Circuit reads `circuit.ts` first, then every `.ts` file under `sites/` except `site.ts`. Each of those files is one device.
- Circuit reads `tenants/` and `lib/` only through the files that import them. Other folders are yours. See [Parts and merge](/guide/parts) and [Checks](/guide/checks).

Write a value in the device first. When a second device needs it, move it to `site.ts` or `circuit.ts`.

### The `.circuit` folder

Circuit writes everything in it, so don't edit it by hand. Use the command that each entry gives.

| Entry                       | What it is                                                                                         | Simple | Full |
| --------------------------- | -------------------------------------------------------------------------------------------------- | :----: | :--: |
| `.circuit/version`          | The Circuit version the project runs. `circuit update` changes it. Committed.                      |   ✅   |  ❌  |
| `.circuit/secrets`          | Your [secrets](/guide/secrets), each one encrypted. Change them with `circuit secrets`. Committed. |   ✅   |  ✅  |
| `.circuit/types/`           | The editor's types. After `circuit update`, the next run writes them again.                        |   ✅   |  ❌  |
| `.circuit/hooks/pre-commit` | The [commit check](/guide/secrets#the-commit-check).                                               |   ✅   |  ✅  |
| `.circuit/cache/`           | Temporary. Git ignores it.                                                                         |   ✅   |  ✅  |

In a [full install](/guide/install#full-install), `package.json` pins the version, and the types come from the Circuit package in `node_modules`.

## The network

```ts
// circuit.ts
// The network, AS64500: what holds for all of it. Circuit reads this file first, then every device file under sites/.

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
    },
});
```

| Field         | Is                                                                                                                                                  |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `asn`         | Your AS. BGP uses it unless a device sets `routing.bgp.asn`. Optional: an office network without one leaves it out.                                 |
| `prefixes`    | Your address blocks, with names. Devices use them by name.                                                                                          |
| `communities` | Your BGP community scheme. See [Communities](/guide/communities).                                                                                   |
| `sites`       | Each site's `description` (and `number`, if communities tag by site). That's all.                                                                   |
| `checks`      | Circuit's checks to turn on, and your own. See [Checks](/guide/checks).                                                                             |
| `secrets`     | Optional. Another secrets file for this network, such as `{ file: ".circuit/lab-secrets" }`. See [Lab and staging](/guide/secrets#lab-and-staging). |

Name the network after its AS, like `as64500`. If you have two networks, write two `circuit()` calls, and export each under its own name.

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

- `literal` keeps values exactly as written, so the editor can check them where they're used.
- Write an address once, with its length (`192.0.2.1/25`). Where only a host fits, like a `next_hop`, Circuit drops the length.
- A device takes a VLAN whole: `vlans: { mgmt: site_a.vlans.mgmt }`.

## A device

```ts
// sites/site-a/edge-01.ts
// edge-01, the router: one transit and the management LAN.

import { as64500 } from "../../circuit";
import { site_a } from "./site";

export default as64500.device({
    name: "edge-01",
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
            "25g-1": { description: "Hurricane Electric", addresses: ["198.51.100.2/30"] },
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
                "hurricane-electric": {
                    address: "198.51.100.1",
                    remote_as: 6939,
                    description: "Hurricane Electric",
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
                rules: [
                    { if: { connection_state: ["established", "related"] }, then: "accept" },
                    {
                        description: "Nothing new in from the internet",
                        if: { in_interface_set: "uplinks", connection_state: ["new"] },
                        then: "drop",
                    },
                ],
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

One device per file: `export default <network>.device({...})`.

| Field        | Is                                                                                                                                  |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `name`       | The hostname.                                                                                                                       |
| `include`    | Where it takes [parts](/guide/parts) from. Right after `name`.                                                                      |
| `site`       | One of your sites. The editor suggests them.                                                                                        |
| `role`       | Free text, like `Router`.                                                                                                           |
| `platform`   | `routeros`, `vrp`, `raisecom-ros`, `junos`, or `fortios`.                                                                           |
| `model`      | The hardware. It decides the port names.                                                                                            |
| `connection` | How Circuit logs in: `host` and `user`.                                                                                             |
| the rest     | `system`, `management`, `monitoring`, `interfaces`, `switching`, `services`, `routing`, `firewall`. Hover a field to read about it. |

- **Ports** are `<speed>-<position>`, like `25g-1`. Circuit prints them the vendor's way, such as `sfp28-1` on RouterOS or `10GE1/0/1` on VRP. A port the model doesn't have is an error.
- **Links go both ways.** Write `link` on both ends. The port's `description` should give the far end, like `switch-01 10GE1/0/1`. Circuit warns if it doesn't, but never writes it for you.

Every name you use must exist on the device, and what you leave out is turned off. See [Principles](/guide/introduction#principles).

The switch is shorter:

```ts
// sites/site-a/switch-01.ts
// switch-01: the management VLAN to the router.

import { as64500 } from "../../circuit";
import { site_a } from "./site";

export default as64500.device({
    name: "switch-01",
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

Data is `snake_case` (fields, `presets`, your variables). Functions are `camelCase`.
