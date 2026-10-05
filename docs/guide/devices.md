# Devices

Each device is one file that calls `defineDevice`. The file says everything the device should run.

```ts
import { defineDevice, secret } from "@takodotid/circuit";

export default defineDevice({
    name: "switch",
    platform: "vrp",
    model: "CE6855-48S6Q-HI",
    connection: { host: "192.168.10.2", user: "operator" },
    users: { operator: { role: "admin", password: secret("SWITCH_PASSWORD") } },
    management: { allow: ["192.168.10.0/24"], ssh: {} },

    vlans: { mgmt: { id: 10 }, home: { id: 20 } },
    ports: {
        "10g-1": { description: "Router", trunk_vlans: ["mgmt", "home"] },
        "10g-2": { description: "Desk", access_vlan: "home" },
    },
    interfaces: { mgmt: { type: "vlan", vlan: "mgmt", addresses: ["192.168.10.2/24"] } },
    routing: { static: [{ prefix: "0.0.0.0/0", via: "192.168.10.1" }] },
});
```

Hover any field in your editor to see what it does. The [schema reference](/reference/schema) lists every field.

## What a device can hold

| Field                | What it is                                                                                                              |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `name`               | The device's name. Circuit sets it as the hostname.                                                                     |
| `platform`, `model`  | The operating system, such as `routeros`, and the hardware model. Together they decide the commands and the port names. |
| `connection`         | How Circuit logs in: the management address, the SSH port, and which of `users` it logs in as.                          |
| `system`             | Timezone, login banner, DNS, NTP, logging and IP settings.                                                              |
| `users`              | Who can log in. A user not listed here is removed.                                                                      |
| `management`         | Which services are on (SSH, web, API, SNMP) and which addresses may use them.                                           |
| `certificates`       | Certificates the device shows to clients or trusts.                                                                     |
| `vlans`              | The VLANs the device has, by name.                                                                                      |
| `ports`              | The physical ports. A port not listed here is shut down.                                                                |
| `interfaces`         | VLAN interfaces, loopbacks, LAGs, and GRE, VXLAN and WireGuard tunnels.                                                 |
| `vrfs`               | Separate routing tables.                                                                                                |
| `routing`            | Static routes, BGP, OSPF and RPKI.                                                                                      |
| `policies`           | Route policies: ordered rules that decide which routes are accepted, and change them.                                   |
| `prefix_sets`        | Lists of prefixes, written out or fetched from a registry.                                                              |
| `firewall`           | Filter rules, NAT and address lists.                                                                                    |
| `acls`               | Hardware ACLs, which filter in the switch chip. A port uses one with `acl`.                                             |
| `dhcp`, `dhcp_relay` | DHCP servers, and relays that forward DHCP to a server elsewhere.                                                       |
| `flow_export`        | NetFlow, IPFIX or sFlow, to see what traffic goes where.                                                                |
| `lldp`, `stp`        | Neighbor discovery and spanning tree, for the whole device. A port can override either.                                 |
| `hardware_offload`   | Forward in hardware where the device can. An interface can override it.                                                 |

## Port names

Ports are named by speed and position: `10g-1` is the first 10G port, `100g-2` the second 100G port. Circuit knows what each vendor calls them, so `10g-1` becomes `10GE1/0/1` on a Huawei switch and `sfp28-1` on a MikroTik router.

The model decides which ports exist. A port the model does not have is an error in your editor.

## Names are checked

A device can only refer to names it declares itself:

```ts
vlans: { mgmt: { id: 99 } },
ports: {
    "10g-1": { access_vlan: "mgmt" },   // fine
    "10g-2": { access_vlan: "mgnt" },   // an error: there is no VLAN called mgnt
},
```

The same is true for interfaces, policies, prefix sets, BGP groups, ACLs, address lists, users, VRFs and certificates.

## Sharing values between devices

A device file is ordinary TypeScript, so a value two devices share is a constant in one file that both import:

```ts
// site.ts
import type { Vlan } from "@takodotid/circuit";

export const vlans = {
    mgmt: { id: 10, description: "Management" },
    home: { id: 20, description: "Home" },
} as const satisfies Record<string, Vlan>;
```

`satisfies Record<string, Vlan>` checks each VLAN where it is written, so a mistake shows up in `site.ts` instead of in every device that uses it.

Anything you would otherwise copy and paste can be a function that returns config. The [colocation pattern](/patterns/colocation) does this for its tenants.

## Combining config from several places

Sometimes a device's ports come partly from its own file and partly from a function, for example one that works out each customer's ports. Spreading both with `...` is risky: if both have a port called `10g-1`, one silently replaces the other.

`merge` combines them and stops with an error when two of them have the same name:

```ts
import { defineDevice, merge } from "@takodotid/circuit";

export default defineDevice({
    // ...
    ports: merge(customerPorts("tor-01"), {
        "40g-1": { description: "Uplink", trunk_vlans: ["mgmt", "servers"] },
    }),
});
```

## When a device cannot do what you wrote

Circuit uses the same field names for every vendor, but not every device can do everything. For example, a Huawei switch has no firewall, and a Raisecom switch has no BGP.

If you write a field that the device's platform cannot do, `circuit validate` reports it as an error, names the field and gives the reason. `diff` and `apply` refuse to run for that device until you remove the field. Circuit never skips a field quietly, so what you read in the file is always what the device runs.

[Platforms](/platforms/) has a table of what each platform can do.
