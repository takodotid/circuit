# Colocation with tenants

A provider whose customers each get their own networks: a VLAN for their servers' public addresses, one for their BMCs, maybe a private one between their own machines. The pattern keeps tenants apart from the infrastructure, one file each, and derives everything else.

```
my-network/
  site-a/             infrastructure only: one file per device, and site values
    border-01.ts
    tor-01.ts
    site.ts
  tenants/            one file per tenant: what is the tenant's own
    acme.ts
    index.ts
  shared/
    tenancy.ts        turns a tenant into what each device carries
    checks.ts         your rules: tenants distinct, ports their own, blocks not overlapping
  circuit.config.ts
```

## A tenant file

Only what is the tenant's, and how it wants to be served.

```ts
// tenants/acme.ts
import { tenant } from "../shared/tenancy";

export default tenant({
    username: "acme",
    number: 3,
    ipv4: [{ prefix: "192.0.2.64/29", gateway: "192.0.2.65" }],
    ipv6: [{ prefix: "2001:db8:100::/64", gateway: "2001:db8:100::1" }],
    acl: [{ description: "UDP to acme above 2G", match: { protocol: "udp" }, action: "accept", rate: "2G" }],
    ports: {
        "tor-01": {
            "10g-5": { description: "acme server 1", trunk: ["internet", "private"] },
            "10g-6": { description: "acme BMC 1", access: "oob" },
        },
    },
});
```

## What tenancy derives

A function per device takes every tenant and returns plain config:

- VLAN numbers and names from the tenant number and username;
- the router's interfaces, with each block's gateway, DHCP for the out-of-band network, firewall and NAT rules;
- the tenant's edge rules, scoped to its blocks, in the router's ACL toward the exchanges and transits;
- its ports on each switch, and a private VLAN only on the switches where one of its ports is in it, never on the router.

The device files combine that with their own through `merge`, which stops at a name both hold instead of letting one silently win:

```ts
// site-a/tor-01.ts
vlans: merge(pick("mgmt"), tenantVlans(TENANTS), privateVlans(TENANTS, "tor-01")),
ports: merge(portsOn(TENANTS, "tor-01"), {
    "40g-1": { description: "Uplink", trunk_vlans: ["mgmt", ...tenantVlanNames(TENANTS)] },
}),
```

Names stay type-checked, because the result goes through `defineDevice`.

## Checks that keep it honest

Checks in `shared/checks.ts` keep tenants apart:

- usernames and numbers are unique;
- a tenant's port carries that tenant's VLANs and nothing else;
- no block overlaps another tenant's or the infrastructure's;
- `trustBoundary` from the presets, with the transit and exchange VLANs untrusted and every tenant VLAN trusted, so unfiltered traffic reaches a tenant only through the router.

## Joining and leaving

A tenant joins with a file and leaves when it goes: the config supersedes the devices, so the next apply removes everything the tenant had, everywhere.
