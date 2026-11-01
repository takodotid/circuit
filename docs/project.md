# How to write a project

A project is a folder of TypeScript files that describe one network: one file per device, plus the facts several devices share. It is plain data. It imports nothing from Circuit, and needs no npm and no Node: Circuit's functions are globals, and the editor reads their types from `.circuit/types`.

The example on this page is a whole project, a router and a switch at one site with one tenant. It passes `tsc` and `circuit validate` as written.

## Start

1. Install Circuit. The installer asks a few questions, then writes the project: `circuit.ts`, `sites/`, `tenants/`, `tsconfig.json`, `.gitignore`, an encrypted `.env`, and the editor's types in `.circuit/types`. In a folder without a project, `circuit` offers to start one.
2. Open the folder in VS Code. It needs nothing else: `tsconfig.json` points the editor at `.circuit/types`.
3. Add a site in `circuit.ts`, then write each device in `sites/<site>/<device>.ts`.
4. Run `circuit validate` in the folder, or `circuit validate --project my-network` from anywhere.

After Circuit is updated, it writes `.circuit/types` again the next time it runs in the project, and changes nothing else.

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
- `communities` is the network's BGP community scheme (see [Communities](#communities)).
- `sites` is each site's `description`, and its `number` when a community tags routes by site. A site is only that: Circuit takes nothing from it into a device. Each device's `site` is one of these, and the editor suggests them.
- `checks` turns on Circuit's checks and names your own (see [Checks](#checks)).
- `integrations` (PeeringDB, LibreNMS, NetBox) is checked, and `circuit env` lists its secrets, but no v1 command uses it yet.

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

1. `name` is the hostname. `include`, right after it, lists where the device takes parts from (see [Parts](#parts-include-part-and-merge)).
2. `site` is one of the network's sites. `role` is free text, such as `Router`.
3. `platform` picks the operating system: `routeros`, `vrp`, `raisecom-ros`, `junos` or `fortios`. `model` is one of the platform's models, and decides the port names.
4. `connection` is how Circuit logs in: `host`, and `user`, one of `system.users`. `host` is its own value, apart from any interface's address.
5. The rest is the device's groups: `system`, `management`, `monitoring`, `interfaces`, `switching`, `services`, `routing`, `firewall`. [The model](model.md) says what each holds. Hover a field in the editor to read its documentation.

A port is `<speed>-<position>`: `25g-1` to `25g-12`, `100g-1`, `100g-2` and `1g-1` on this router. The editor says `25g-13 is not a port of CCR2216-1G-12XS-2XQ`. Circuit prints a port as the platform does, such as `sfp28-2` for `25g-2` on RouterOS and `10GE1/0/1` for `10g-1` on VRP.

A field that refers to something takes only a name the device declares, itself or through its parts: a VLAN, an interface, an address set, a policy. The editor suggests them, and a wrong one is an error.

What a device doesn't write is removed from the device or set back to its default. A field is written only when it has a value: no `enabled: false`.

A `link` is written at both ends, each in its own device file. The port's `description` names the far end as printed there, `<far device> <far port>`, such as `switch-01 10GE1/0/1`. Circuit checks that the far end links back, and warns when the description doesn't name it. It never writes the description for you.

A secret is `secret("NAME")`: read from the environment or `.env` when a device is applied. Each value in `.env` is encrypted, so `.env` is committed; `circuit env set NAME` adds one. A value that is an `op://` reference is read from 1Password. `secretFile("path")` reads a file, such as a private key. `circuit env` lists every secret and says which ones the config needs that `.env` lacks.

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

## Rules

Every kind of rule is plain data, the condition first: `if`, then `then`. Without `if`, a rule applies to every route or packet. Each takes an optional, short `description`.

| Written                                                                    | Does                                                                                             |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `{ if: { prefix_set: "ours" }, then: "reject" }`                           | A route policy rule. `then` is `accept` or `reject`, and ends the policy for that route.         |
| `{ if: { ... }, set: { local_pref: 200 }, then: "accept" }`                | Changes the route, then accepts it. Without `then`, the route goes on to the next rule, changed. |
| `{ call: "common-import" }`                                                | Runs another policy. It holds nothing else.                                                      |
| `{ communities: "import" }`, `{ communities: "export" }`                   | The rules the network's community scheme means there (see [Communities](#communities)).          |
| `{ if: { protocol: "icmp" }, then: "accept" }`                             | A filter rule: `accept`, `drop` or `reject`; also `fast_path`.                                   |
| `{ if: { src: "...", out_interface_set: "uplinks" }, then: "masquerade" }` | A NAT rule: `masquerade`, `snat` or `dnat`; also `to_address`, `to_port`.                        |
| `{ if: { vlan: "...", src: "..." }, then: "drop" }`                        | An ACL rule: `accept` or `drop`; also `rate`.                                                    |
| `{ match: { src: "..." }, routing_table: "..." }`                          | A policy routing rule. It keeps `match`, and always writes its table.                            |

Order decides in five places, and the first rule runs first: a filter chain's `rules`, `firewall.nat.source` and `.destination`, each of `routing.policies`, `routing.policy_routing`, and each of `switching.acls`. Each is an array with no numbers, written whole in one place: the device's file or one part. Rules from another file are placed in it with `merge` (below), so the order reads in one place. Every other list is a set, and its order means nothing.

A few things in a rule save writing:

- **A list in a match.** In a filter or NAT rule, `src`, `dst`, `in_interface` and `out_interface` take a list; in an ACL rule, `vlan`, `src` and `dst`. A list matches any of its items: Circuit writes one rule per value, each with the rule's description, before a platform reads the device.
- **An interface set.** `firewall.interface_sets.uplinks` lists some of the device's ports and interfaces. A filter or NAT rule matches it with `in_interface_set` or `out_interface_set`. Each part may add its own interfaces to a set.
- **`bgpNeighbors()`**, as an address set, holds every BGP neighbor address of the device. A new neighbor needs no second line. Rules name the set, never its items.
- **`management.allow`** takes a list of prefixes, or the name of one of the device's address sets, so sources written for the firewall are written once.
- **`presets`** are rules and values from public standards, such as `presets.bgp_sanity` (RFC 7454 and RPKI invalid) and `presets.rfc1918`. They are plain data: place them with `merge`, or pick what you need.

## Parts: include, part and merge

A part is what one file adds to a device written in another: a tenant's VLAN and ports, an upstream's sessions, a monitoring host every device sends to. Tenants and upstreams are the project's own idea, not Circuit's: Circuit only knows devices.

```ts
// tenants/tenant-a.ts
// Tenant A: its VLAN on the router and the switch, its gateway on the router, its server's port, and its rules on the router.

const vlans = literal({
    "tenant-a": { id: 200, description: "Tenant A" },
});

export const tenant_a = {
    parts: {
        "edge-01": part("device", {
            switching: { vlans },
            interfaces: {
                ethernet: { "25g-2": { trunk_vlans: ["tenant-a"] } },
                vlan_interface: { "tenant-a-gw": { vlan: "tenant-a", description: "Tenant A gateway", addresses: ["203.0.113.65/26"] } },
            },
        }),
        "switch-01": part("device", {
            switching: { vlans },
            interfaces: {
                ethernet: {
                    "10g-1": { trunk_vlans: ["tenant-a"] },
                    "10g-5": { description: "tenant-a server-1", access_vlan: "tenant-a" },
                },
            },
        }),
    },
    rules: {
        edge_forward: part("filter", [
            { description: "tenant-a: no private ranges", if: { src: "203.0.113.64/26", dst: presets.rfc1918 }, then: "drop" },
            { description: "tenant-a: to the internet", if: { src: "203.0.113.64/26", out_interface_set: "uplinks" }, then: "accept" },
        ]),
    },
};
```

```ts
// tenants/index.ts
// Every tenant, merged whole. A new tenant joins the list.

import { tenant_a } from "./tenant-a";

export const tenants = merge([tenant_a]);
```

1. `part("device", {...})` is a part of a device, in a device's shape, and the editor checks it as one. Parts are keyed by hostname: `"edge-01": part("device", ...)`.
2. `part("filter", [...])` is rules for an ordered list another file writes. The kinds are `filter`, `nat`, `acl`, `policy` and `policy-routing`, and each rule is checked as its kind.
3. `merge([tenant_a, tenant_b])` makes the tenants one: parts by hostname, and each rule list with tenant A's rules first. Two tenants that give one name two values, such as one VLAN name with two IDs, stop Circuit, naming the path, both values and both files.
4. A device takes the parts with `include: [tenants.parts]`. Each source is keyed by hostname, and the device takes the part under its own `name`, merged after its own object, in the list's order. The names a part declares, such as `tenant-a`, are then the device's names too.
5. The router places the rules where they go in its own list: `rules: merge([own_rule, tenants.rules.edge_forward, last_rule])`. Rules made with `part` that no device places stop Circuit, so none is forgotten.

`merge` takes a list of items, each one value or a list, and you never write `...`. What it makes depends on the field it lands in:

- **A list field** gives one flat list. Each item is checked as one of that field's items, with the device's names. An ordered list keeps every item in order; any other list keeps the same item once.
- **A map field** (a part, VLANs, interfaces, a source keyed by hostname) is merged key by key. A list inside joins. A value written twice with two values is an error naming both files. An ordered list from two places is an error too: it is written whole in one place.
- **No field**, such as `export const tenants = merge([...])`: maps merged when every item is a map, else one list.

Write a tenant's names (VLANs, interfaces, sets), addresses, VLAN IDs and secrets by hand in its own file, so a text search finds each one. When many tenants share one shape, a function in `lib/` may build their parts from their data. Whoever changes that function then needs to read TypeScript.

## Communities

A network's BGP large communities, `asn:code:value` (RFC 8092), used as RFC 8195 describes. You write them in three places, and Circuit writes the rest.

1. **The scheme, once**, in `circuit({ communities })`. Each option is an object with its `code`, and may have its own `description`. `asn` is the network's when absent.
2. **Each neighbor or neighbor group** says which `groups` it is in, and its own `blackhole` community when it takes blackholes from us: `communities: { groups: ["transit"], blackhole: "64501:666" }`.
3. **Each policy** places `{ communities: "import" }` or `{ communities: "export" }` where those rules go.

| Option                     | Community                                             | Is                                  |
| -------------------------- | ----------------------------------------------------- | ----------------------------------- |
| `groups`                   | `{ value, description? }` each                        | the groups the `_group` options use |
| `learned_from_group`       | `asn:code:<group value>`                              | a tag                               |
| `learned_at_site`          | `asn:code:<site number>`                              | a tag, from the site's `number`     |
| `learned_from_as`          | `asn:code:<asn>`                                      | a tag, never on a customer's routes |
| `do_not_announce_to_as`    | `asn:code:<asn>`, `asn:code:0` for anyone             | a request                           |
| `do_not_announce_to_group` | `asn:code:<group value>`                              | a request                           |
| `prepend`                  | `once`, `twice`, `three_times`, each `asn:code:<asn>` | a request                           |
| `blackhole`                | `asn:code:0`                                          | a request                           |
| `custom_descriptions`      | your own words for one community                      | for the catalogue                   |

An import rule takes off every request (unless `accept_requests` lists it) and every tag of ours, then adds each tag the scheme has: the neighbor's groups, the device's site, the neighbor's AS. `add_tags: false` leaves the tags as they came, for iBGP.

An export rule rejects a blackholed route, or passes it on with the neighbor's `blackhole` community; rejects a route asked not to go to anyone, to this AS or to its groups; prepends where asked; then takes our communities off. `keep_ours: true` keeps them, and `send_tags: true` keeps the tags. Toward iBGP, write `keep_ours`: Circuit stops without it. Toward a customer, there is no request about one AS.

A policy one AS uses gets the rules in its place. A policy several ASes use keeps what they share, and each AS with rules of its own gets a policy `<policy>-as<asn>` that holds them and then calls the shared one. `circuit communities` prints the catalogue, one community per line.

## Checks

`checks` in `circuit()` turns on Circuit's own checks by name, and names yours.

| Check                             | Checks                                                                                                                                                                                                                            |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `untrusted_vlans`                 | Where a VLAN written `untrusted: true` may go. `filtering_devices` are the only ones that give it an address; `mixed_links` are switch pairs that may carry both kinds. `untrusted: true` is allowed only while this check is on. |
| `exports_end_in_reject`           | Every BGP export ends in a reject of everything, but toward a customer.                                                                                                                                                           |
| `imports_end_in_accept_or_reject` | Every BGP import ends in a rule that decides for every route.                                                                                                                                                                     |
| `native_vlans_are_dead_ends`      | A native VLAN is native on one trunk of a device at most, and no member anywhere on it.                                                                                                                                           |
| `tunnels_outside_offered`         | A GRE or VXLAN tunnel's local address is outside what the neighbors over it are offered.                                                                                                                                          |
| `same_vlan_ids`                   | One VLAN name has one ID on every device of the network.                                                                                                                                                                          |

Any other name takes a function of your own, which reads the network and returns what it found:

```ts
// lib/checks.ts
// Our own checks, beside Circuit's. circuit.ts names them in `checks`.

import type { Check } from "circuit";

/** Every BGP neighbor says who it is. */
export const neighborsDescribed: Check = (network) =>
    network.devices.flatMap((device) =>
        Object.entries(device.routing?.bgp?.neighbors ?? {})
            .filter(([, neighbor]) => !neighbor.description)
            .map(([name]) => ({
                device: device.name,
                path: `routing.bgp.neighbors.${name}`,
                message: "says nothing about who it is: write a description.",
            }))
    );
```

A check reads the network as its devices will run it: its `asn`, its `prefixes`, and each device with its parts merged, each neighbor with what it takes from its group, each `call` replaced by the called rules, `{ communities }` rules written out, and sets replaced by what they hold. It reads a copy, so it changes nothing. A finding is a `message`, and the `device` and `path` it is about when it knows them: Circuit then prints the file and line that write that path. For IP math, use the global `address`: `address.contains(outer, inner)`, `.overlaps(a, b)`, `.family(x)`, `.host(x)`, `.first(x)`, `.last(x)`.

`lib/` is the one place a project imports from Circuit, and only types: `import type { Check } from "circuit"`.

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

## What Circuit tells you

The editor checks most things as you type: keys, values, names, ports, sites. `circuit validate` checks the rest, and says each problem with its file and line:

```
sites/site-a/switch-01.ts:32: switch-01: switching.stp.mod: no such field. Did you mean mode?
tenants/tenant-a.ts:21: switch-01: interfaces.ethernet.10g-5.descripton: no such field. Did you mean description?
```

It stops on any key Circuit doesn't take, a name a device doesn't declare, a port the model doesn't have, a link that doesn't link back, a value two parts write with two values, an ordered list written in two places, rules placed nowhere, a device file with no device or with two, a hostname twice, and `untrusted: true` without its check. It warns, and goes on, when a linked port's description doesn't name the far end.

The editor misses some of these, and Circuit doesn't:

- A misspelt key in a map keyed by name inside a part, such as a port in a tenant's file, is caught by `circuit validate` only.
- A map written with `merge` in a device file, such as `address_sets: merge([a, b])`, hides its names from the rest of the device in the editor, which then shows false errors where they are used. Circuit reads it right. Write the map out, or bring it with `include`.
- Two single rules merged into a value of their own, `const two = merge([rule_a, rule_b])`, are read as two maps: the editor says `then is written twice`. Write `part("filter", [rule_a, rule_b])`.
- `bgpNeighbors()` is the whole set. Inside `merge` with other addresses it adds nothing.
