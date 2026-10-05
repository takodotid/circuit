# Colocation with tenants

A provider that hosts servers for its customers, the tenants. Each tenant gets its own VLAN for its public addresses, its own switch ports, and if it wants one, a private network between its own servers.

This is the [edge router](/patterns/edge-router) with a top-of-rack switch and tenants added. Each tenant is one small file. Everything the router and the switch need for it, such as its VLANs, its gateway and its ports, is worked out from that file.

```bash
bunx @takodotid/circuit new my-network --pattern colocation --asn 64500
```

```
my-network/
  circuit.config.ts    the devices, the checks, and what is published
  routing.ts           your AS number and BGP communities
  edge-01.ts           the router
  tor-01.ts            the top-of-rack switch
  tenancy.ts           turns a tenant's file into what each device needs
  tenants/
    acme.ts            one file per tenant
    index.ts           the list of tenants
  checks.ts            rules of your own
  .env                 the devices' passwords, never committed
  .circuit/            what Circuit writes
```

## A tenant

A tenant's file only says what is the tenant's own: its name, its number, its public blocks, its ports, and any edge rules it wants.

<<< @/../templates/colocation/tenants/acme.ts

From the name `acme` and the number `1`:

- its internet VLAN is `acme-internet`, number 1001, on the router and the switch;
- its private VLAN is `acme-private`, number 2001. It exists only on a switch where one of acme's ports uses it, and never on the router;
- the router holds each block's `gateway`, which acme's servers use as their default gateway;
- acme's `acl` rule caps UDP toward its IPv4 blocks at 1 Gbit/s, in the router's switch chip.

A tenant joins by being added to `tenants/index.ts`, and leaves by being removed. Because the file is the whole truth, the next apply removes everything it had, everywhere.

<<< @/../templates/colocation/tenants/index.ts

## tenancy.ts

The functions that turn tenants into device config. To change how VLANs are numbered or named, change it here, once, for every tenant.

<<< @/../templates/colocation/tenancy.ts

## edge-01.ts

The edge router, with a trunk to the switch. `merge` combines the router's own VLANs and interfaces with the tenants'. If a tenant ever got a name the router already uses, `merge` stops with an error instead of letting one silently replace the other.

<<< @/../templates/colocation/edge-01.ts

## tor-01.ts

The switch has every tenant's ports, and one uplink to the router.

<<< @/../templates/colocation/tor-01.ts

## checks.ts

Besides the edge router's checks, tenants must never share a name, a number or an address. `trustBoundary` makes sure traffic from the transit and the exchange reaches tenants only through the router.

<<< @/../templates/colocation/checks.ts

## circuit.config.ts

<<< @/../templates/colocation/circuit.config.ts

## Growing

- **More switches.** Add a file per switch, and the switch's name under each tenant's `ports`. `privateVlans` puts a tenant's private VLAN only where it is used.
- **More options per tenant.** Add a field to `Tenant` in `tenancy.ts`, such as a WireGuard tunnel or a DHCP server for the tenant's BMCs, and the code that turns it into config. Leave the field out of a tenant to turn it off.
- **A tenant with one address.** Give it a /32, and let several tenants share one gateway address: the router's address on each tenant's VLAN is written as `{ address, peer }`, pointed at the tenant's address.
