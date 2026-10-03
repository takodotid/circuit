# Presets

Most networks write the same building blocks. `@takodotid/circuit/presets` has them, and each returns plain config you place where it belongs: nothing applies itself.

```ts
import {
    antiSpoofing,
    badTcpFlags,
    bgpSanity,
    exportsEndInReject,
    MARTIANS,
    PRIVATE_RANGES,
    tunnelsOutsideOffered,
} from "@takodotid/circuit/presets";
```

| Preset                  | Returns                                                                        | Goes in                         |
| ----------------------- | ------------------------------------------------------------------------------ | ------------------------------- |
| `MARTIANS`              | IPv4 sources that never arrive from the internet                               | Address lists, ACLs             |
| `PRIVATE_RANGES`        | RFC 1918 space                                                                 | Address lists, ACLs             |
| `antiSpoofing(vlan, …)` | Hardware ACL rules dropping those sources arriving on a VLAN                   | `acls`                          |
| `badTcpFlags()`         | Firewall rules dropping TCP flag combinations no legitimate packet carries     | `firewall.filter.forward.rules` |
| `bgpSanity(lengths?)`   | Policy rules rejecting prefixes too short or too long, and RPKI invalid        | `policies`                      |
| `exportsEndInReject`    | A check: every BGP export ends in a reject that matches everything             | `checks`                        |
| `tunnelsOutsideOffered` | A check: a tunnel is never sourced from a prefix offered to a neighbor over it | `checks`                        |

## Example

```ts
export default defineDevice({
    // ...
    policies: {
        SANITY: bgpSanity(),
        "UPSTREAM-IMPORT": [{ call: "SANITY" }, { action: "accept" }],
    },
    firewall: {
        filter: { forward: { rules: [{ match: { state: ["established", "related"] }, action: "accept" }, ...badTcpFlags()] } },
    },
    acls: {
        edge: [...antiSpoofing("transit", ["192.0.2.0/24", ...MARTIANS, ...PRIVATE_RANGES])],
    },
});
```

```ts
export default defineNetwork({
    devices,
    checks: [exportsEndInReject, tunnelsOutsideOffered],
    state: "state",
});
```

Descriptions are part of what the device holds, so a preset's are fixed: changing one between releases is a breaking change.
