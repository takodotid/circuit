# An edge router

Your own AS, announced to transits and internet exchanges. The router is the trust boundary: whatever arrives from outside is filtered there.

```
my-network/
  site-a/
    edge-01.ts
    site.ts
  shared/
    routing.ts        your AS, your prefixes, what you announce
  circuit.config.ts
```

## Routing facts, written once

```ts
// shared/routing.ts
import type { PolicyRule, Prefix } from "@takodotid/circuit";

export const ASN = 64500;
export const prefixes = { v4: "192.0.2.0/24", v6: "2001:db8::/32" } as const satisfies Record<string, Prefix>;

export const announce: PolicyRule<never, never>[] = [
    { description: "Our IPv4", match: { prefix: prefixes.v4 }, action: "accept" },
    { description: "Our IPv6", match: { prefix: prefixes.v6 }, action: "accept" },
    { description: "Nothing else leaves", action: "reject" },
];
```

## The router

```ts
// site-a/edge-01.ts
import { defineDevice } from "@takodotid/circuit";
import { antiSpoofing, badTcpFlags, bgpSanity, MARTIANS, PRIVATE_RANGES } from "@takodotid/circuit/presets";
import { announce, ASN, prefixes } from "../shared/routing";

export default defineDevice({
    // name, platform, model, connection, users, ports, interfaces ...
    routing: {
        bgp: {
            asn: ASN,
            networks: [prefixes.v4, prefixes.v6],
            neighbors: {
                "transit-v4": {
                    address: "203.0.113.1",
                    remote_as: 64501,
                    local_role: "customer",
                    import: "TRANSIT-IMPORT",
                    export: "TRANSIT-EXPORT",
                    max_prefixes: 1_200_000,
                },
                "ix-rs1": {
                    address: "198.51.100.1",
                    remote_as: 64502,
                    local_role: "rs-client",
                    import: "IX-IMPORT",
                    export: "IX-EXPORT",
                    max_prefixes: 50_000,
                },
            },
        },
    },
    policies: {
        SANITY: bgpSanity(),
        "TRANSIT-IMPORT": [{ call: "SANITY" }, { set: { local_pref: 100 } }, { action: "accept" }],
        "IX-IMPORT": [{ call: "SANITY" }, { set: { local_pref: 300 } }, { action: "accept" }],
        "TRANSIT-EXPORT": announce,
        "IX-EXPORT": announce,
    },
    firewall: { filter: { forward: { rules: [...badTcpFlags()] } } },
    acls: { edge: [...antiSpoofing("transit", [prefixes.v4, ...MARTIANS, ...PRIVATE_RANGES])] },
});
```

## Rules worth enforcing

```ts
// circuit.config.ts
import { defineNetwork } from "@takodotid/circuit";
import { exportsEndInReject, tunnelsOutsideOffered } from "@takodotid/circuit/presets";
import edge from "./site-a/edge-01";

export default defineNetwork({ devices: [edge], checks: [exportsEndInReject, tunnelsOutsideOffered], state: "state", asn: 64500 });
```

`local_role` turns on RFC 9234 leak protection on both sides. `max_prefixes` closes a session that suddenly sends far more than it should.
