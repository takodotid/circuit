# Helpers

Many networks write the same building blocks: the same list of addresses that never come from the internet, the same filter for broken TCP packets, the same rules for which BGP routes to refuse. Helpers are those blocks, ready to use.

A helper only returns plain config, like the config you write yourself. Nothing happens until you put it somewhere in a device or in `circuit.config.ts`.

```ts
import { Bgp, Checks, Exchange, Filters } from "@takodotid/circuit/helpers";
```

| Helper                                       | What it gives you                                                         | Where it goes                    |
| -------------------------------------------- | ------------------------------------------------------------------------- | -------------------------------- |
| `Filters.MARTIANS`                           | IPv4 sources that never come from the internet                            | anywhere a list of prefixes goes |
| `Filters.PRIVATE_RANGES`                     | IPv4 private space, RFC 1918                                              | anywhere a list of prefixes goes |
| `Filters.antiSpoofing(vlan, …)`              | ACL rules that drop forged sources arriving on a VLAN                     | `acls`                           |
| `Filters.antiAmplification(destinations, …)` | ACL rules that drop reflected UDP floods                                  | `acls`                           |
| `Filters.AMPLIFIERS`                         | UDP ports of services attackers use to reflect floods                     | anywhere a list of ports goes    |
| `Filters.badTcpFlags()`                      | Firewall rules that drop TCP packets no real program sends                | `firewall.filter.forward.rules`  |
| `Bgp.sanity(lengths?)`                       | Route policy rules that refuse routes no neighbor should send             | `policies`                       |
| `Bgp.communityScheme({ … })`                 | Your BGP communities: rules for your routers and the list you publish     | `policies`, `communities`        |
| `Checks.exportsEndInReject`                  | A check: every BGP export ends by rejecting what it did not accept        | `checks`                         |
| `Checks.tunnelsOutsideOffered`               | A check: a tunnel never starts from an address you announce through it    | `checks`                         |
| `Checks.trustBoundary({ … })`                | A check: traffic from outside reaches your VLANs only through a router    | `checks`                         |
| `Checks.nativeVlansAreDeadEnds`              | A check: a native VLAN is native on one trunk and carried nowhere else    | `checks`                         |
| `Exchange.build({ … }, members)`             | An internet exchange's member ports, and a check that keeps members apart | `ports`, `checks`                |

The descriptions on the rules a helper makes are fixed, because a device stores them. A release that changes one is a breaking change.

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

## BGP communities

`Bgp.communityScheme` turns what your BGP communities mean into the rules your routers need and the list you publish. It has its own page: [BGP communities](/guide/communities).

## Checks

```ts
import { Checks } from "@takodotid/circuit/helpers";

export default defineNetwork({
    devices,
    checks: [
        Checks.exportsEndInReject,
        Checks.tunnelsOutsideOffered,
        Checks.trustBoundary({ untrusted: ["transit", "ix"], routers: ["edge-01"] }),
        Checks.nativeVlansAreDeadEnds,
    ],
});
```

**`Checks.exportsEndInReject`** makes sure every BGP export policy ends with a rule that rejects everything. Without it, a route you never meant to announce could leak out. The check skips an export to a neighbor whose `role` is `customer`, because sending a customer every route you know is what it pays for.

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

`Exchange.build` makes an exchange's member ports and a check that keeps members apart. See [Running an internet exchange](/use-cases/internet-exchange#exchange-build).
