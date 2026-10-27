# Colocation with tenants

A provider that hosts servers for its customers, the tenants. Each tenant gets its own VLAN for its public addresses, its own switch ports, and if it wants one, a private network between its own servers.

This is the [edge router](/patterns/edge-router) with a top-of-rack switch and tenants added. Each tenant is one small file. Everything the router and the switch need for it, such as its VLANs, its gateway and its ports, is worked out from that file.

```bash
npx @takodotid/circuit new my-network --pattern colocation --asn 64500
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

A tenant's file writes everything its devices carry for it: its VLANs, the router's addresses on its public VLAN, its ports, and any edge rules it wants.

<<< @/../templates/colocation/tenants/acme.ts

- `internet.vlan`, `acme-internet` with ID 1001, is on the router and the switch;
- `internet.gateways` are the router's addresses on it, which acme's servers use as their default gateway. Each one's length says the tenant's block;
- `private.vlan`, `acme-private` with ID 2001, exists only on a switch where one of acme's ports uses it, and never on the router;
- its ports are written as any port is, with the VLANs by name;
- acme's `acl` rule limits UDP traffic toward its IPv4 blocks to 1 Gbit/s, in the router's switch chip.

A tenant joins by being added to `tenants/index.ts`, and leaves by being removed. Because the file is the whole truth, the next apply removes everything it had, everywhere.

<<< @/../templates/colocation/tenants/index.ts

## tenancy.ts

Plain functions that gather what the tenants' files wrote, for one device: the VLANs, the ports, the router's interfaces and the edge rules.

<<< @/../templates/colocation/tenancy.ts

## edge-01.ts

The edge router, with a trunk to the switch. `Utils.merge` combines the router's own VLANs and interfaces with the tenants'. If a tenant ever got a name the router already uses, `Utils.merge` stops with an error instead of letting one silently replace the other.

<<< @/../templates/colocation/edge-01.ts

## tor-01.ts

The switch has every tenant's ports, and one uplink to the router.

<<< @/../templates/colocation/tor-01.ts

## checks.ts

Besides the edge router's checks, tenants must never share a name, a VLAN, an address or a port. `Checks.trustBoundary` makes sure traffic from the transit and the exchange reaches tenants only through the router.

<<< @/../templates/colocation/checks.ts

## circuit.config.ts

<<< @/../templates/colocation/circuit.config.ts

## Growing

- **More switches.** Add a file per switch, and the switch's name under each tenant's `ports`. `privateVlans` puts a tenant's private VLAN only where it is used.
- **More options per tenant.** Add a field to `Tenant` in `tenancy.ts`, such as a WireGuard tunnel or a DHCP server for the tenant's BMCs, and the code that turns it into config. Leave the field out of a tenant to turn it off.
- **A tenant with one address.** Give it a /32, and let several tenants share one gateway address: the router's address on each tenant's VLAN is written as `{ address, peer }`, with `peer` set to the tenant's address.
