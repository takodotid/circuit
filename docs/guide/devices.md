# Devices

A device is one call to `defineDevice`. Every field is documented in the schema, so hovering a field in the editor shows what it does; this page is the map.

| Field                | What it holds                                                               |
| -------------------- | --------------------------------------------------------------------------- |
| `name`               | The hostname                                                                |
| `platform`, `model`  | The operating system, which picks the adapter, and the hardware model       |
| `connection`         | Management address, SSH port, and which of `users` logs in                  |
| `system`             | Timezone, banner, DNS, NTP, logging, IP stack settings                      |
| `users`              | Logins. Users not listed are removed                                        |
| `management`         | SSH, web, API, SNMP and console, and the sources allowed to use them        |
| `certificates`       | Certificates the device presents or trusts                                  |
| `vlans`              | VLANs by name                                                               |
| `ports`              | Physical ports. A port not declared is shut down                            |
| `interfaces`         | VLAN interfaces, loopbacks, LAGs, GRE, VXLAN and WireGuard                  |
| `vrfs`               | Separate routing tables                                                     |
| `routing`            | Static routes, BGP, OSPF and RPKI                                           |
| `policies`           | Route policies, ordered rules with matches and actions                      |
| `prefix_sets`        | Prefix lists, typed or fetched from a registry                              |
| `firewall`           | Filter chains, NAT and address sets                                         |
| `acls`               | Hardware ACLs, applied to a port with `acl`                                 |
| `dhcp`, `dhcp_relay` | DHCP servers and relays                                                     |
| `flow_export`        | NetFlow, IPFIX or sFlow                                                     |
| `lldp`, `stp`        | Discovery and spanning tree, device-wide; a port may override either        |
| `hardware_offload`   | Forwarding in hardware where the platform can; an interface may override it |

## Port names

Ports are named `<speed>-<position>`: `10g-1` is the first 10G cage, `100g-2` the second 100G cage. The model decides which exist, and the adapter knows what the platform calls each one. A name the model does not have does not compile.

## Names are checked

A device's own names are the only ones its references accept:

```ts
vlans: { mgmt: { id: 99 } },
ports: {
    "10g-1": { access_vlan: "mgmt" },   // fine
    "10g-2": { access_vlan: "mgnt" },   // does not compile
},
```

The same holds for interfaces, policies, prefix sets, BGP groups, ACLs, address sets, users, VRFs and certificates.

## Sharing values

Config is plain data, so shared values are imports, and anything repetitive is a function that returns data. `satisfies` with a schema type keeps a shared value checked where it is written, not only where it is used:

```ts
import type { Vlan } from "@takodotid/circuit";

export const vlans = {
    mgmt: { id: 99, description: "Management" },
    servers: { id: 100, description: "Servers" },
} as const satisfies Record<string, Vlan>;
```

## What a platform cannot do

Not every platform can express every field. One it cannot is reported by `validate`, with the reason, and the device is not applied. See [Platforms](/platforms/).
