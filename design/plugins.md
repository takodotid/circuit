# Plugins (on hold)

Can Circuit ship optional building blocks without giving up decision 2 (Circuit is primitive)? Studied during the v1 design, not decided.

A plugin turns plain data into parts of devices, by hostname. A project's own `lib/` function does that today; a plugin would give the pattern a name, types and a place.

```ts
export const as64500 = circuit({
    asn: 64500,
    plugins: { tenancy: true, ix_members: true },
});
```

## Rules it would keep

1. Its output is ordinary parts and rules; Studio and `diff` show them like anything written by hand.
2. It adds no field to a device and changes no core behaviour.
3. Off by default.
4. Built-in plugins are general: no network's names or numbers inside.

## Candidates

| Plugin          | For                      | Input                                                    | Output                                                        |
| --------------- | ------------------------ | -------------------------------------------------------- | ------------------------------------------------------------- |
| `tenancy`       | colocation, hosting      | a site plan and a tenant (VLANs, blocks, ports, gateway) | VLANs on trunks, gateway, DHCP, NAT, routes, filter rules     |
| `ix_members`    | exchange operators       | peering LAN, route servers, a member                     | member port (MAC limit, ethertypes), RS sessions, prefix sets |
| `bgp_customers` | transit, partial transit | a customer (AS, prefixes or AS-SET, sessions)            | sessions, prefix sets from a registry, policies, communities  |
| `office`        | offices, campuses        | departments (VLAN, subnet, ports)                        | access ports, gateway, DHCP, rules between departments        |

## Open questions

- Typing: `as64500.tenant()` exists only when `tenancy` is on.
- Versioning: a plugin that changes its output changes devices, so it needs its own change notes.
- How far a built-in plugin goes before it becomes opinionated.
