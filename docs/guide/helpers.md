# Helpers

Many networks write the same building blocks: the same list of addresses that never come from the internet, the same filter for broken TCP packets, the same rules for which BGP routes to refuse. Helpers are those blocks, ready to use.

A helper only returns plain config, like the config you write yourself. Nothing happens until you put it somewhere in a device or in `circuit.config.ts`.

```ts
import { Bgp, Cables, Checks, Exchange, Filters, Upstreams } from "@takodotid/circuit/helpers";
```

| Helper                                       | What it gives you                                                                                                                                    | Where it goes                                                       |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `Filters.MARTIANS`                           | IPv4 sources that never come from the internet                                                                                                       | anywhere a list of prefixes goes                                    |
| `Filters.PRIVATE_RANGES`                     | IPv4 private space, RFC 1918                                                                                                                         | anywhere a list of prefixes goes                                    |
| `Filters.antiSpoofing(vlan, …)`              | ACL rules that drop forged sources arriving on a VLAN                                                                                                | `acls`                                                              |
| `Filters.antiAmplification(destinations, …)` | ACL rules that drop reflected UDP floods                                                                                                             | `acls`                                                              |
| `Filters.AMPLIFIERS`                         | UDP ports of services attackers use to reflect floods                                                                                                | anywhere a list of ports goes                                       |
| `Filters.badTcpFlags()`                      | Firewall rules that drop TCP packets no real program sends                                                                                           | `firewall.filter.forward.rules`                                     |
| `Bgp.sanity(lengths?)`                       | Route policy rules that refuse routes no neighbor should send                                                                                        | `policies`                                                          |
| `Bgp.communityScheme({ … })`                 | Your BGP communities: rules for your routers and the list you publish                                                                                | `policies`, `communities`                                           |
| `Bgp.announce(prefixes)`                     | An export that announces these prefixes and nothing else                                                                                             | `policies`                                                          |
| `Bgp.learn({ … })`                           | An import that takes a neighbor's routes: sanity, preference, where they came from                                                                   | `policies`                                                          |
| `Bgp.defaultOnly({ … })`                     | Import rules that take a transit's default route, and with `reject: true` nothing else                                                               | `policies`                                                          |
| `Cables.link({ … })`, `Cables.lag({ … })`    | Both ends of a cable or a LAG from one entry, each port described by the far port's label                                                            | `ports` on both devices                                             |
| `Checks.exportsEndInReject`                  | A check: every BGP export ends by rejecting what it did not accept                                                                                   | `checks`                                                            |
| `Checks.importsEndInAcceptOrReject`          | A check: every BGP import ends by accepting or rejecting what is left                                                                                | `checks`                                                            |
| `Checks.tunnelsOutsideOffered`               | A check: a tunnel never starts from an address you announce through it                                                                               | `checks`                                                            |
| `Checks.trustBoundary({ … })`                | A check: traffic from outside reaches your VLANs only through a router                                                                               | `checks`                                                            |
| `Checks.nativeVlansAreDeadEnds`              | A check: a native VLAN is native on one trunk and carried nowhere else                                                                               | `checks`                                                            |
| `Exchange.build({ … }, members)`             | An internet exchange's member ports, a check that keeps members apart, and its route servers' BIRD or OpenBGPD config                                | `ports`, `checks`, a file on each route server                      |
| `Upstreams.define({ … })`                    | Each transit, exchange and peer written once, with every name it puts on a device: VLANs, router interfaces, BGP sessions and policies, switch ports | `vlans`, `interfaces`, `routing.bgp`, `policies`, `ports`, `checks` |

The descriptions on the rules a helper makes are fixed, because a device stores them. A release that changes one is a breaking change.

## Cables

A cable between two of your devices has two ends, and each end's port names the other in `link`. `Cables` writes both from one entry, so a LAG of eight cables is eight lines, not sixteen entries kept in step by hand:

```ts
const firewallLag = Cables.lag({
    a: { device: "router-1", lag: "to-firewall" },
    b: { device: "firewall-1", lag: "to-router" },
    cables: { "25g-1": "10g-2", "25g-2": "10g-1" }, // read from end A
});

// router-1:   ports: { ...firewallLag.a }
// firewall-1: ports: { ...firewallLag.b }
```

Each port gets `lag` and `link`. `validate` checks that each port exists on its device's model and that both ends agree.

A port gets only the description you write. `describe` writes one for every port of the entry, from its far end: the device, the port by Circuit's name, and, when that end names its `platform` and `model`, the port as printed on the device, so the person on site reads the label they see:

```ts
Cables.lag({
    a: { device: "router-1", platform: "routeros", model: "CCR2216-1G-12XS-2XQ", lag: "to-firewall" },
    b: { device: "firewall-1", platform: "fortios", model: "FG-3700D", lag: "to-router" },
    cables: { "25g-1": "10g-2" },
    describe: (far) => `${far.device} ${far.label}`, // "firewall-1 port6" on the router, "router-1 sfp28-1" on the firewall
});
```

`Cables.link` does the same for one cable, with `port` on each end instead of `lag`. Both take `through` for a carrier in between; see [Checking the cabling](/guide/network#checking-the-cabling).

## Edge filters

Traffic from the internet sometimes has a forged source address: your own address space, a private address, or one that cannot exist on the internet at all. It is always an attack or a mistake. `Filters.antiSpoofing` drops it in the router's switch chip, before it costs any CPU:

```ts
acls: {
    edge: [...Filters.antiSpoofing("transit", ["198.51.100.0/24", ...Filters.MARTIANS, ...Filters.PRIVATE_RANGES])],
},
```

The largest floods are reflected. The attacker sends small requests to thousands of DNS, NTP or memcached servers with your address as the source, and the servers send their much larger replies to you. Every reply comes from the port of the service, so `Filters.antiAmplification` recognises the flood by its source port and drops it in the switch chip:

```ts
acls: {
    edge: [
        ...Filters.antiSpoofing("transit", ["198.51.100.0/24", ...Filters.MARTIANS, ...Filters.PRIVATE_RANGES]),
        ...Filters.antiAmplification(["198.51.100.0/24"]),
    ],
},
```

The list says what to protect: your own address space. What happens to UDP toward it:

1. `Filters.AMPLIFIERS` lists memcached, SSDP, chargen and other services that nobody asks across the internet. A reply from any of them is dropped.
2. A reply from DNS, NTP or SNMP is dropped only when it goes to a port below 1024 that is not the service's own. A real answer goes back to the port that asked, 1024 or above, so a host running its own resolver, time server or monitoring still gets it.
3. A reply too large for one packet arrives in fragments, and only the first has a port. The rest are dropped as well, so they never reach the CPU. A host that receives large UDP on purpose, such as SIP or some VPNs, keeps its fragments with `keep_fragments`:

```ts
...Filters.antiAmplification(["198.51.100.0/24"], { keep_fragments: ["198.51.100.64/27"] }),
```

This is not a limit. A game server, a voice call or any other UDP that does not come from these ports passes untouched, at any rate.

A flood that comes from random ports looks like real traffic, and only a stateful firewall or the host itself can tell them apart. On a router that tracks connections, such a flood fills the connection table long before it fills a link. `untracked` keeps traffic to your customers' space out of the table:

```ts
firewall: {
    untracked: ["198.51.100.64/27"],
},
```

Accept the state `untracked` in the forward chain, since no other state applies to it.

An address NAT uses inside an untracked prefix stays tracked. That is a source translation's `to`, a destination translation's `to`, or the `dst` a destination translation matches. For each one, Circuit writes two accept rules before the untracked rules: one for traffic to the address, one for traffic from it. A reply to a NAT address that skipped tracking would never be translated back. On RouterOS they appear in the raw table as `Tracked for NAT, to 198.51.100.70` and `Tracked for NAT, from 198.51.100.70`.

`Filters.badTcpFlags()` drops TCP packets with flag combinations that no real program sends, such as SYN and FIN together. Scanners send them to learn about your network:

```ts
firewall: {
    filter: {
        forward: {
            rules: [{ match: { state: ["established", "related"] }, action: "accept" }, ...Filters.badTcpFlags()],
        },
    },
},
```

## BGP sanity

`Bgp.sanity()` refuses routes that should never be on the internet: IPv4 shorter than /8 or longer than /24, IPv6 shorter than /16 or longer than /48, and routes RPKI marks invalid. Put it in its own policy, and call it first from every import:

```ts
policies: {
    SANITY: Bgp.sanity(),
    "TRANSIT-IN": [{ call: "SANITY" }, { set: { local_pref: 100 } }, { action: "accept" }],
},
```

Other lengths can be given: `Bgp.sanity({ ipv4: { min: 8, max: 24 }, ipv6: { min: 16, max: 48 } })`.

## BGP policies

Three policies come back on almost every edge router. Each helper gives the rules, so they go straight into `policies`:

```ts
policies: {
    SANITY: Bgp.sanity(),
    // What we announce: each prefix at exactly its length, then a reject of everything else.
    "TRANSIT-OUT": Bgp.announce([{ prefix: "192.0.2.0/24", description: "Our IPv4" }, { prefix: "2001:db8::/32" }]),
    // What we take from a transit that sends its full table: sanity, preference, where it came from.
    "TRANSIT-IN": Bgp.learn({ sanity: "SANITY", local_pref: 250, tag: { large: "64500:1:1" }, sources: ["192.0.2.1", "2001:db8::1"] }),
    // What we take from a transit that sends only its default route.
    "BACKUP-IN": Bgp.defaultOnly({ local_pref: 100, description: "Transit B default", reject: true }),
},
```

- `Bgp.announce` writes an accept for each prefix, then `{ description: "Nothing else", action: "reject" }`, the unconditional reject `Checks.exportsEndInReject` looks for. The reject is there by default, so a forgotten one can't leak routes. For an export that adds rules after the accepts, `Bgp.announce(prefixes, { reject: false })` leaves it out; end that export with a reject of your own.
- `Bgp.learn` writes these rules, in this order, each only when its option is given:
    1. your own rules from `before`, as written;
    2. `{ call: "SANITY" }` for `sanity: "SANITY"`, or the rules of `Bgp.sanity()` themselves when you leave `sanity` out;
    3. `{ set: { preferred_source: "192.0.2.1" } }` for each of `sources`, one per family;
    4. `{ set: { local_pref: 250 } }`;
    5. the tag: `{ large: "64500:1:1" }` becomes `{ description: "Tag 64500:1:1", set: { add_large_communities: ["64500:1:1"] } }`, `{ standard: "64500:100" }` the same with `add_communities`, and a rule, such as one from [`Bgp.communityScheme`](/guide/communities)'s `tag`, is used as it is;
    6. `{ action: "accept" }`.
- `Bgp.defaultOnly` accepts `0.0.0.0/0` and `::/0`. With `{ reject: true }` it ends in `{ description: "Nothing else", action: "reject" }`, so the import takes the default route only. Without it, any other route goes on to the next rule, so `[...Bgp.defaultOnly(), ...Bgp.learn()]` takes both.

FortiOS refuses `Bgp.learn`, and `validate` names each rule it can't hold. A FortiOS route map stops at the first rule that matches, so it can't hold rules 3 to 5, which change a route and go on to the next rule; and the sanity rules match RPKI, which FortiOS doesn't have. On FortiOS, write the import by hand, with what rules 3 to 5 set in the rule that accepts. See [Platforms](/platforms/).

## BGP communities

`Bgp.communityScheme` turns what your BGP communities mean into the rules your routers need and the list you publish. It has its own page: [BGP communities](/guide/communities).

## Checks

```ts
import { Checks } from "@takodotid/circuit/helpers";

export default defineNetwork({
    devices,
    checks: [
        Checks.exportsEndInReject,
        Checks.importsEndInAcceptOrReject,
        Checks.tunnelsOutsideOffered,
        Checks.trustBoundary({ untrusted: ["transit", "ix"], routers: ["edge-01"] }),
        Checks.nativeVlansAreDeadEnds,
    ],
});
```

**`Checks.exportsEndInReject`** makes sure every BGP export policy ends with a rule that rejects everything. Without it, a route you never meant to announce could leak out. The check skips an export to a neighbor whose `role` is `customer`, because sending a customer every route you know is what it pays for.

**`Checks.importsEndInAcceptOrReject`** makes sure every BGP import policy ends with a rule that accepts or rejects everything left. A route no rule decides on is rejected anyway, but written out, the import says what it takes.

**`Checks.tunnelsOutsideOffered`** makes sure a GRE or VXLAN tunnel does not start from an address inside a prefix you announce to the neighbor on the other side. If it did, the neighbor's replies would be routed back into the tunnel itself.

**`Checks.trustBoundary`** protects your network from traffic that has not been filtered yet. You list two things:

- `untrusted`: the VLANs that carry traffic straight from outside, such as a transit, an internet exchange or an ISP handoff.
- `routers`: the devices that filter that traffic.

Every other VLAN counts as yours, so a VLAN you add later is protected without being listed. The check then reports:

- a port or LAG that carries an untrusted VLAN next to one of yours, unless it is on a router or connects to one;
- an address on an untrusted VLAN on a device that is not a router.

A switch may carry the transit and your own VLANs on the trunk to the router, because the router filters between them. The same mix on a port to a server is an error.

A site can reach into a second building through a switch there, such as for an internet exchange whose port is in that building, with the exchange's VLAN and the switch's own management on one cable. List that link in `extended`, by the names of its two switches: `extended: [["switch-a", "switch-b"]]`. The mix is then allowed on that link only, and neither switch may give the untrusted VLAN an address.

**`Checks.nativeVlansAreDeadEnds`** keeps each native VLAN to one trunk. A native VLAN (`native_vlan`) is the VLAN that untagged frames on a trunk go into. On a switch, it is an untagged member of every trunk it is native on, so two trunks with the same native VLAN are joined: every untagged frame from one leaves on the other. Two routers of different providers on those trunks then see each other. On each device, the check reports a native VLAN that is:

- native on more than one port or LAG;
- also the `access_vlan` of a port or LAG, or in its `trunk_vlans`.

Give each trunk a native VLAN of its own, used nowhere else. The check is not built in, because some designs share a native VLAN on purpose. A router on a stick, one router routing between VLANs over a single trunk, can take a VLAN untagged on that trunk while the switch gives the same VLAN to its access ports.

## Helpers for checks of your own

These help when you write your own checks. Each example is a complete check.

### Checks.vlansOf

`Checks.vlansOf(port)` returns every VLAN a port or LAG carries, untagged and tagged together.

```ts
import type { Check } from "@takodotid/circuit";
import { Checks } from "@takodotid/circuit/helpers";

// No port carries more than 20 VLANs.
const fewVlansPerPort: Check = (devices) =>
    devices.flatMap((device) =>
        Object.entries(device.ports ?? {})
            .filter(([, port]) => port && Checks.vlansOf(port).length > 20)
            .map(([name]) => ({ level: "warning" as const, device: device.name, message: `port ${name} carries more than 20 VLANs` }))
    );
```

### Bgp.neighborPolicies

`Bgp.neighborPolicies(device)` returns each BGP neighbor with its `role`, its `import` and its `export`, taken from the neighbor itself or from its group.

```ts
import type { Check } from "@takodotid/circuit";
import { Bgp } from "@takodotid/circuit/helpers";

// Every BGP session filters what it takes in.
const everyImportFiltered: Check = (devices) =>
    devices.flatMap((device) =>
        Bgp.neighborPolicies(device)
            .filter((neighbor) => !neighbor.import)
            .map((neighbor) => ({ level: "error" as const, device: device.name, message: `${neighbor.name} has no import policy` }))
    );
```

### Bgp.offered

`Bgp.offered(device, policy)` returns every prefix that an export policy accepts with `match.prefix`.

```ts
import type { Check } from "@takodotid/circuit";
import { Bgp } from "@takodotid/circuit/helpers";

// A test prefix is never announced to anyone.
const testPrefixStaysHome: Check = (devices) =>
    devices.flatMap((device) =>
        Bgp.neighborPolicies(device)
            .filter((neighbor) => Bgp.offered(device, neighbor.export).includes("203.0.113.0/24"))
            .map((neighbor) => ({ level: "error" as const, device: device.name, message: `${neighbor.name} is offered the test prefix` }))
    );
```

## Internet exchange

`Exchange.build` makes an exchange's member ports, a check that keeps members apart, and the config of its route servers. See [Running an internet exchange](/use-cases/internet-exchange#exchange-build).

## Upstreams

A network that buys transit, joins exchanges or peers writes each upstream in several places: a VLAN on the switches, an interface and addresses on the router, a BGP session per address, an import and an export, the switch port where the handoff lands, and sometimes a tunnel with its firewall rule. `Upstreams.define` takes each upstream once and builds every device's part, so they never drift apart. Every name a device carries is written in the catalog, so a search of your config finds it:

```ts
const OURS = [{ prefix: "198.51.100.0/24", description: "Our IPv4" }] as const;

const upstreams = Upstreams.define(
    {
        transit_a: {
            name: "Transit A",
            asn: 64510,
            role: "provider",
            handoff: {
                vlan: { name: "transit-a", id: 3001 },
                interface: "uplink-transit-a",
                addresses: ["203.0.113.2/30"],
                port: { device: "switch-1", port: "10g-4" },
            },
            sessions: { "transit-a": { address: "203.0.113.1" } },
            limits: { ipv4: 1_200_000 },
            import: { name: "TRANSIT-A-IN", rules: Bgp.defaultOnly({ local_pref: 100, reject: true }) },
            export: { name: "TRANSIT-A-OUT", rules: [{ set: { prepend: 2 } }, ...Bgp.announce(OURS)] },
        },
        ix_b: {
            name: "IX B",
            asn: 64511,
            role: "rs",
            handoff: {
                vlan: { name: "ix-b", id: 3002 },
                interface: "uplink-ix-b",
                addresses: ["192.0.2.10/24"],
                port: { device: "switch-1", port: "10g-5" },
            },
            sessions: { "ix-b-rs1": { address: "192.0.2.1" }, "ix-b-rs2": { address: "192.0.2.2" } },
            group: "ix-b",
            import: { name: "IX-B-IN", rules: [{ set: { local_pref: 200 } }, { action: "accept" }] },
            export: { name: "IX-B-OUT", rules: Bgp.announce(OURS) },
        },
    },
    {
        // What every upstream's policies share, written once. Plain functions over each policy's rules.
        mapImports: (rules) => [{ call: "SANITY" }, ...rules],
        mapExports: (rules, key, upstream) => [...communities.actions(upstream.asn), ...rules],
    }
);
```

On the router:

```ts
vlans: upstreams.vlans(),
interfaces: { ...upstreams.interfaces() },
routing: { bgp: { asn: 64500, groups: upstreams.groups(), neighbors: upstreams.neighbors() } },
policies: { SANITY: Bgp.sanity(), ...upstreams.policies() },
```

On the switch where the handoffs land:

```ts
vlans: upstreams.vlans("switch-1"),
ports: { "10g-1": { trunk_vlans: upstreams.vlansOn("switch-1") }, ...upstreams.ports("switch-1") },
```

What each field builds:

| Field                            | On the device                                                                                                                                                                            |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `handoff.vlan`, `handoff.native` | A VLAN of that name and ID. `native` is for an upstream that sends its VLAN tagged: its switch port takes it as the native VLAN, and nothing else is in it.                              |
| `handoff.interface`              | The router's VLAN interface on the handoff, with `addresses`.                                                                                                                            |
| `tunnel.interface`               | The router's GRE tunnel to it.                                                                                                                                                           |
| `import.name`, `export.name`     | The policies its sessions use. A policy is `rules`, in order, passed through `mapImports` or `mapExports` when you give one. Nothing else is added.                                      |
| `group`                          | A BGP group of that name holding the AS, role, policies, `table` and `multihop` settings; each session names it. Without `group`, each session holds them.                               |
| `table`                          | The routing table its sessions put what they learn in: `main`, or one of the router's `routing.tables`. On RouterOS they announce from it too. Main when absent; write `main` to say so. |
| `communities`                    | What the upstream offers, as its NOC gives it: `blackhole`, its blackhole community, and `do_not_announce_to(asn)`, how to ask it not to pass our routes to one AS.                      |
| `limits`                         | Each session's `max_prefixes`, by the family of its address.                                                                                                                             |

The defaults it applies, each written here:

- A handoff's switch port has LLDP and spanning tree off, since it faces someone else's network. `port: { lldp: true }` or `port: { stp: true }` turns either on.
- `vlans()` and `vlans(device)` give the VLANs and natives together; with a device, only those of the upstreams arriving on its ports.
- `drop_private` only lists the upstream's VLAN in `privateDrops()`, for an ACL of your own that drops RFC 1918 sources.
- `Bgp.announce` ends in a reject unless you pass `{ reject: false }`; see [BGP policies](#bgp-policies). `Checks.exportsEndInReject` and `Checks.importsEndInAcceptOrReject` check that every export ends in a reject and every import in an accept or a reject.

Two helpers read the catalog:

- `Upstreams.catalog({ … })` checks a catalog and gives it back as written, so you can read its keys and entries before `define` takes it, or keep it in a file of its own.
- `Upstreams.doNotAnnounceTo(upstream, asns, description)` is one export rule adding the upstream's `do_not_announce_to` community for each AS: an exchange's route servers then keep our routes from those networks. Nothing for no AS; an upstream without `do_not_announce_to` is an error, since it can't be asked.

```ts
mapExports: (rules, _, upstream) => [
    ...communities.actions(upstream), // passes a blackhole on with upstream.communities.blackhole
    ...Upstreams.doNotAnnounceTo(upstream, upstream.communities?.do_not_announce_to ? [64666] : [], "Not to AS64666"),
    ...rules,
],
```

The rest:

- `uplinks()` lists the router's interface toward each handoff, for NAT and lists like it. `untrusted()` lists every handoff VLAN and native, for `Checks.trustBoundary`. `tunnelRules()` gives the firewall rules that take each tunnel from its far end, and `addresses()` every session's address. Each list follows the catalog's order.
- Two upstreams given one name stop with an error naming both.
- A misspelled key is refused by the type, by its name: `'limts' does not exist in type 'Upstream'`.
- The policies and prefix sets that the rules name are checked by `validate`, not by the editor.
