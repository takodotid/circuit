# Presets

Many networks write the same building blocks: the same list of addresses that never come from the internet, the same filter for broken TCP packets, the same rules for which BGP routes to refuse. Presets are those blocks, ready to use.

A preset only returns plain config, like the config you write yourself. Nothing happens until you put it somewhere in a device or in `circuit.config.ts`.

```ts
import { antiSpoofing, badTcpFlags, bgpSanity, MARTIANS } from "@takodotid/circuit/presets";
```

| Preset                   | What it gives you                                                      | Where it goes                    |
| ------------------------ | ---------------------------------------------------------------------- | -------------------------------- |
| `MARTIANS`               | IPv4 sources that never come from the internet                         | anywhere a list of prefixes goes |
| `PRIVATE_RANGES`         | IPv4 private space, RFC 1918                                           | anywhere a list of prefixes goes |
| `antiSpoofing(vlan, …)`  | ACL rules that drop forged sources arriving on a VLAN                  | `acls`                           |
| `badTcpFlags()`          | Firewall rules that drop TCP packets no real program sends             | `firewall.filter.forward.rules`  |
| `bgpSanity(lengths?)`    | Route policy rules that refuse routes no neighbor should send          | `policies`                       |
| `communityScheme({ … })` | Your BGP communities: rules for your routers and the list you publish  | `policies`, `communities`        |
| `exportsEndInReject`     | A check: every BGP export ends by rejecting what it did not accept     | `checks`                         |
| `tunnelsOutsideOffered`  | A check: a tunnel never starts from an address it carries routes for   | `checks`                         |
| `trustBoundary({ … })`   | A check: traffic from outside reaches your VLANs only through a router | `checks`                         |

The descriptions on the rules a preset makes are fixed, because a device stores them. A release that changes one is a breaking change.

## Edge filters

Traffic from the internet sometimes carries a forged source address: your own address space, a private address, or one that cannot exist on the internet at all. It is always an attack or a mistake. `antiSpoofing` drops it in the router's switch chip, before it costs any CPU:

```ts
acls: {
    edge: [...antiSpoofing("transit", ["198.51.100.0/24", ...MARTIANS, ...PRIVATE_RANGES])],
},
```

`badTcpFlags()` drops TCP packets with flag combinations that no real program sends, such as SYN and FIN together. Scanners send them to learn about your network:

```ts
firewall: {
    filter: {
        forward: {
            rules: [{ match: { state: ["established", "related"] }, action: "accept" }, ...badTcpFlags()],
        },
    },
},
```

## BGP sanity

`bgpSanity()` refuses routes that should never be on the internet: IPv4 shorter than /8 or longer than /24, IPv6 shorter than /16 or longer than /48, and routes RPKI marks invalid. Put it in its own policy, and call it first from every import:

```ts
policies: {
    SANITY: bgpSanity(),
    "TRANSIT-IN": [{ call: "SANITY" }, { set: { local_pref: 100 } }, { action: "accept" }],
},
```

Other lengths can be given: `bgpSanity({ ipv4: { min: 8, max: 24 }, ipv6: { min: 16, max: 48 } })`.

## BGP communities

`communityScheme` turns what your BGP communities mean into the rules your routers need and the list you publish. It has its own page: [BGP communities](/guide/communities).

## Checks

```ts
import { exportsEndInReject, trustBoundary, tunnelsOutsideOffered } from "@takodotid/circuit/presets";

export default defineNetwork({
    devices,
    checks: [exportsEndInReject, tunnelsOutsideOffered, trustBoundary({ untrusted: ["transit", "ix"], routers: ["edge-01"] })],
});
```

**`exportsEndInReject`** makes sure every BGP export policy ends with a rule that rejects everything. Without it, a route you never meant to announce could leak out.

**`tunnelsOutsideOffered`** makes sure a GRE or VXLAN tunnel does not start from an address inside a prefix you announce to the neighbor on the other side. If it did, the neighbor's replies would be routed back into the tunnel itself.

**`trustBoundary`** protects your network from traffic that has not been filtered yet. You list two things:

- `untrusted`: the VLANs that carry traffic straight from outside, such as a transit, an internet exchange or an ISP handoff.
- `routers`: the devices that filter that traffic.

Every other VLAN counts as yours, so a VLAN you add later is protected without being listed. The check then reports:

- a port or LAG that carries an untrusted VLAN next to one of yours, unless it is on a router or connects to one;
- an address on an untrusted VLAN on a device that is not a router.

A switch may carry the transit and your own VLANs on the trunk to the router, because the router filters between them. The same mix on a port to a server is an error.

## Helpers for checks of your own

These help when you write your own checks. Each example is a complete check.

### vlansOf

`vlansOf(port)` is every VLAN a port or LAG carries, untagged and tagged together.

```ts
import type { Check } from "@takodotid/circuit";
import { vlansOf } from "@takodotid/circuit/presets";

// No port carries more than 20 VLANs.
const fewVlansPerPort: Check = (devices) =>
    devices.flatMap((device) =>
        Object.entries(device.ports ?? {})
            .filter(([, port]) => port && vlansOf(port).length > 20)
            .map(([name]) => ({ level: "warning" as const, device: device.name, message: `port ${name} carries more than 20 VLANs` }))
    );
```

### neighborPolicies

`neighborPolicies(device)` is each BGP neighbor with its import and export policy, taken from the neighbor itself or from its group.

```ts
import type { Check } from "@takodotid/circuit";
import { neighborPolicies } from "@takodotid/circuit/presets";

// Every BGP session filters what it takes in.
const everyImportFiltered: Check = (devices) =>
    devices.flatMap((device) =>
        neighborPolicies(device)
            .filter((neighbor) => !neighbor.import)
            .map((neighbor) => ({ level: "error" as const, device: device.name, message: `${neighbor.name} has no import policy` }))
    );
```

### offered

`offered(device, policy)` is the prefixes an export policy accepts by name.

```ts
import type { Check } from "@takodotid/circuit";
import { neighborPolicies, offered } from "@takodotid/circuit/presets";

// A test prefix is never announced to anyone.
const testPrefixStaysHome: Check = (devices) =>
    devices.flatMap((device) =>
        neighborPolicies(device)
            .filter((neighbor) => offered(device, neighbor.export).includes("203.0.113.0/24"))
            .map((neighbor) => ({ level: "error" as const, device: device.name, message: `${neighbor.name} is offered the test prefix` }))
    );
```
