---
title: "Project: a colocation"
description: Host tenants on Circuit's colocation pattern. Read how one small file per tenant becomes VLANs, gateways and ports, then add a tenant yourself and read the plan.
---

# Project: a colocation

In this project you run the network of a <Term means="Renting space, power and cooling in someone else's data centre for your own servers and network equipment.">colocation</Term> business. Customers, the <Term means="A customer of a colocation, with its own servers in the provider's racks and its own networks on the provider's switches.">tenants</Term>, put their servers in your racks, and you give each of them its own network: a VLAN for its public addresses, a block of those addresses with your router as its gateway, ports on your switch, and if it wants one, a private network between its own servers.

It is Circuit's [colocation pattern](/patterns/colocation): the [edge router](/academy/intermediate/project-edge-router) you already built, with a switch and tenants added. Each tenant is one small file, and everything the router and the switch need for it is worked out from that file. You read how, send packets through it, then add a second tenant yourself and read what Circuit plans.

## What a tenant buys

A data centre rents out room in its racks, measured in <Term means="The height of one slot in a standard rack: 1.75 inches, 44.45 mm. Equipment is sold as 1U, 2U and so on, and a full rack is commonly 42U.">rack units</Term>, along with power and cooling. To reach anyone outside the rack, a tenant needs a <Term means="A cable the data centre runs between two customers' racks, or between a customer and a network, inside the same building.">cross-connect</Term> to a network, and in this project that network is yours. What you sell over it is:

- **Internet access**, carried by your edge router to your transit and your exchange.
- **Public addresses**: a block from your own space, routed to the tenant's VLAN, with your router at its first address as the gateway.
- **Ports** on your <Term means="The switch at the top of a rack, which the servers in that rack plug into. ToR for short.">top-of-rack</Term> switch, one per server.
- **A private network**, if the tenant wants its servers to talk to each other without going through the router or the internet.

## Start the project

```bash
npx @takodotid/circuit new my-network --pattern colocation --asn 64500
```

```text
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
```

::: info The names in this project
The template names a well-known transit, Hurricane Electric, and an exchange, SGIX, as stand-ins for your own, as the edge router did. Replace their addresses, AS numbers and port names with what your providers give you.
:::

## A tenant is one file

A tenant's file says only what is the tenant's own: its name, a number no other tenant has, its public blocks, its ports, and any rules for traffic toward it.

<<< @/../templates/colocation/tenants/acme.ts

From the name `acme` and the number `1`, everything else follows:

- its public VLAN is `acme-internet`, 1000 + 1 = 1001, on the router and the switch;
- its private VLAN is `acme-private`, 2000 + 1 = 2001. It exists only on a switch where one of acme's ports uses it, and never on the router;
- the router takes each block's `gateway`, `198.51.100.9/29` and `2001:db8:100:1::1/64`, on `acme-internet`;
- both server ports are trunks carrying both VLANs, tagged, so each server sees two networks.

acme's `acl` rule asks for UDP toward its IPv4 block to be limited to 1 Gbit/s, in the router's switch chip. On RouterOS, a limit like this did not hold back traffic that the router's CPU routes, as its [platform page](/platforms/routeros) records, and traffic to a tenant is routed. Do not count on it to stop a flood; [Attacks on the network](/academy/professional/ddos-and-spoofing) covers what does.

A tenant joins by being added to the list, and leaves by being removed from it:

<<< @/../templates/colocation/tenants/index.ts

## tenancy.ts: from tenants to config

<<< @/../templates/colocation/tenancy.ts

Each function answers one question a device asks:

| Function            | Used by           | What it returns                                                                  |
| ------------------- | ----------------- | -------------------------------------------------------------------------------- |
| `internetVlans`     | router and switch | every tenant's public VLAN                                                       |
| `internetVlanNames` | both trunk ends   | their names, so the trunk carries them all                                       |
| `privateVlans`      | each switch       | the private VLANs of tenants with a port on that switch in their private network |
| `portsOn`           | each switch       | the tenants' ports on that switch                                                |
| `gateways`          | router            | an interface on each public VLAN, with the tenant's gateway addresses            |
| `edgeRules`         | router            | each tenant's `acl` rules, once per outside VLAN and IPv4 block                  |

To change how every tenant is numbered or named, you change it here, once.

## The router and the switch

<<< @/../templates/colocation/edge-01.ts

Most of this is the edge router from the last level. What the tenants add is in four places:

1. **`vlans`** and **`interfaces`** each use `Utils.merge` to combine the router's own with the tenants'. If a tenant were ever named like one of the router's own VLANs, `Utils.merge` stops with an error instead of letting one replace the other.
2. **`100g-1`** is the trunk to the switch, carrying management and every tenant's public VLAN. `link` says which port is at the other end of the cable, so `validate` checks that both ends carry the same VLANs.
3. **`acls.edge`** adds each tenant's rules after the anti-spoofing ones.
4. Nothing in **`routing`** changes. The tenants' blocks are inside `198.51.100.0/24` and `2001:db8:100::/48`, which the router already announces, and each tenant's block is connected to the router, so it routes there by the longest match.

<<< @/../templates/colocation/tor-01.ts

The switch runs VRP, and is managed over VLAN 99 through the router. Its own uplink is merged with every tenant's ports, and `privateVlans` gives it only the private VLANs its ports use.

<TryIt title="Send packets through the tenants' networks">

Send packets between the internet and the servers, and between the tenants. Watch which device each one passes, and on which VLAN.

<TenantPath />

</TryIt>

Two tenants are as far apart as any two networks on the internet: traffic between them is routed by the router, between their public VLANs. A tenant's private network is further still, because only the switch carries it, and only on that tenant's ports.

<Quiz
  question="acme server 1 sends a backup to acme server 2 over acme-private. Which devices does it pass?"
  :choices="['tor-01 only', 'tor-01, then edge-01, then tor-01 again', 'edge-01 only']"
  :answer="0"
  :why="['', 'That is how traffic between two different public networks goes. VLAN 2001 is not on the trunk, so the router never sees it.', 'The servers are not plugged into the router. Every port they have is on tor-01.']"
  explain="Both servers are on VLAN 2001, which exists only on tor-01. The switch passes the frames between the two ports, and nothing reaches the router."
/>

## checks.ts and circuit.config.ts

<<< @/../templates/colocation/checks.ts

Two of the edge router's checks are here, and one of the pattern's own: tenants never share a name, a number or a port, their blocks never overlap, and each gateway is inside its block. `Checks.trustBoundary` makes sure traffic from the transit and the exchange reaches tenants only through the router, which filters it. `Checks.nativeVlansAreDeadEnds` keeps a native VLAN to one trunk, so it never joins two trunks into one.

<<< @/../templates/colocation/circuit.config.ts

## Add a tenant

A second tenant, globex, has signed for one server. First find it some addresses:

```
$ npx circuit addresses 198.51.100.0/24
198.51.100.0/24, originated by edge-01
  198.51.100.8/29, 5 free, next 198.51.100.10
      198.51.100.9  edge-01 acme-internet
  free: 198.51.100.0/29, 198.51.100.16/28, 198.51.100.32/27, 198.51.100.64/26, 198.51.100.128/25
```

`198.51.100.16/28` is free, and its first /29, `198.51.100.16/29`, is 8 addresses: `.16` is the address of the network itself, `.17` is the gateway on the router, `.18` to `.22` are five for globex's servers, and `.23` is the broadcast address. IPv4 is scarce, so give a tenant the smallest block that fits.

<TryIt title="Write globex's file">

Make each decision, then run validate and diff. Every output is what Circuit printed for that combination, run on the template, against a snapshot saved from the template's own build rather than read from a device.

<TenantJoin />

</TryIt>

When every choice is sound, the plan is exactly what the tenant's file promised: on the router, a VLAN interface and the two gateway addresses; on the switch, the VLAN, the port and the VLAN added to the uplink. acme's lines do not move.

Every clash stops `validate`, and each is described in the words of the check that found it: two tenants with one number, overlapping blocks, a gateway outside its block, and a port given to two tenants. That last one matters most. `portsOn` writes each tenant's ports in turn, so without the check the second tenant to list `10g-1` would silently take it, and `10GE1/0/1` would lose acme's VLANs. The check in `checks.ts` says instead: `port 10g-1 on tor-01 is given to both acme and globex`.

<Quiz
  question="globex is given 10g-1, which acme already uses. Which step of the workflow catches it?"
  :choices="['Your editor, with a red line', 'circuit validate, with an error', 'Reading the plan from circuit diff, where 10GE1/0/1 loses acme’s VLANs']"
  :answer="1"
  :why="['10g-1 is a valid port name, so the types are happy. It takes a check that looks at every tenant at once.', '', 'There is no plan to read: diff runs the same checks first, and stops at the error.']"
  explain="The template’s check in checks.ts looks at every tenant’s ports and reports port 10g-1 on tor-01 is given to both acme and globex. An error stops diff and apply, so the port never changes hands."
/>

## When a tenant leaves

A tenant leaves by being removed from `tenants/index.ts`, and the next apply takes away everything it had, everywhere, because the file is the whole truth. When acme leaves, `circuit diff` plans 34 commands for the router and 19 for the switch. On the switch:

```
tor-01: 19 command(s) in 4 step(s)
  VLANs no longer used
    - vlan 1001
    - vlan 2001
    - vlan batch 1001 2001
  interface 10GE1/0/1
    - port trunk allow-pass vlan 1001 2001
    - undo port trunk allow-pass vlan 1
    - port link-type trunk
    - description acme server 1
    + shutdown
  interface 10GE1/0/2
    - port trunk allow-pass vlan 1001 2001
    - undo port trunk allow-pass vlan 1
    - port link-type trunk
    - description acme server 2
    + shutdown
  interface 40GE1/0/1
    - port trunk allow-pass vlan 99 1001
    + port trunk allow-pass vlan 99
```

Its ports are shut, not left open for whoever plugs in next. On the router, acme's VLAN, interface and addresses go, and the switch-chip rules are replaced as a whole, because an ordered list is rewritten in its new order rather than edited in place. Its block, `198.51.100.8/29`, is free again in `circuit addresses`. Before you hand it to someone else, wait until the old tenant's servers are really unplugged.

## Where to go from here

The [pattern's page](/patterns/colocation#growing) shows how it grows: more switches, with each tenant's ports listed under the switch they are on; more options per tenant, such as a tunnel or a DHCP server for its management cards, each a field in `Tenant` and the code that turns it into config; and tenants with a single address that share one gateway.

## Further reading

- [Data centre glossary](https://www.datacentres.com/glossary): colocation, cross-connect, meet-me room and carrier-neutral.
- [Rack unit](https://en.wikipedia.org/wiki/Rack_unit): the size of 1U and the usual 42U rack.
- [Data centers 101](https://resources.telegeography.com/data-centers-101-technical-terms-you-should-know), from TeleGeography: cross-connects and rack density.

## In short

- A colocation hosts tenants' servers and gives each tenant a public VLAN, a block of addresses with the router as gateway, ports, and optionally a private VLAN that stays on the switch.
- Each tenant is one file; `tenancy.ts` turns the list into VLANs, gateways, ports and edge rules for every device.
- `circuit addresses` finds a free block; a /29 has room for five servers besides the network, gateway and broadcast addresses.
- The checks stop clashing numbers, overlapping blocks, stray gateways and a port given to two tenants; the plan shows the rest, so read it.
- Removing a tenant from the list removes everything it had and shuts its ports.
