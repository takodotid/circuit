---
title: "Project: a colocation"
description: Host tenants on Circuit's colocation example. Read how one small file per tenant becomes VLANs, gateways, and ports, then add a tenant yourself and read the plan.
---

# Project: a colocation

In this project you run the network of a <Term means="Renting space, power, and cooling in someone else's data center for your own servers and network equipment.">colocation</Term> business. Customers, the <Term means="A customer that gets its own networks inside yours, such as a colocation customer with its own servers in your racks.">tenants</Term>, put their servers in your racks. You give each of them its own network:

- A VLAN for its public addresses.
- A block of those addresses, with your router as its gateway.
- Ports on your switch.
- If it wants one, a private network between its own servers.

This is Circuit's [colocation example](/guide/examples#colocation-with-tenants). It adds a switch to the [edge router](/academy/intermediate/project-edge-router) you already built, and tenants on both. Each tenant is one small file that holds everything the router and the switch need for it.

## What a tenant buys

A data center rents out room in its racks, measured in <Term means="The height of one slot in a standard rack: 1.75 inches, or 44.45 mm. Equipment is sold as 1U, 2U, and so on, and a full rack is often 42U.">rack units</Term>. Power and cooling come with it. To reach anyone outside the rack, a tenant needs a <Term means="A cable the data center runs between two customers' racks, or between a customer and a network, in the same building.">cross-connect</Term> to a network, and in this project that network is yours. You sell this over it:

- **Internet access**, carried by your edge router to your transit and your exchange.
- **Public addresses**, a block from your own space, routed to the tenant's VLAN. Your router is the gateway, at the first address.
- **Ports** on your <Term means="A switch at the top of a rack of servers. Every server in the rack is cabled to it, and it has a few uplinks to the next layer. ToR for short.">top-of-rack</Term> switch, one per server.
- **A private network**, if the tenant wants its servers to talk to each other without going through the router or the internet.

## Start the project

[Install Circuit](/guide/install), then copy the example's files into the project:

```text
my-network/
  circuit.ts             your AS, your prefixes, communities, and checks
  sites/dc-1/site.ts     what both devices share
  sites/dc-1/edge-01.ts  the router
  sites/dc-1/tor-01.ts   the top-of-rack switch
  tenants/netflix.ts     one file per tenant
  tenants/index.ts       every tenant, merged
  lib/checks.ts          a check of your own
```

::: info The names in this project
As in the edge router, the transit is `hurricane-electric` and the exchange `de-cix`. Replace their addresses, AS numbers, and port names with what your providers give you.
:::

## A tenant is one file

<<< @/../examples/colocation/tenants/netflix.ts

The file of the tenant Netflix holds everything Netflix has, on every device, as [parts](/guide/parts):

- **On the router**, `edge-01`, it adds the VLAN `netflix-internet`, carried on the trunk to the switch. It also adds a VLAN interface with the gateways of Netflix, the first address of each of its blocks.
- **On the switch**, `tor-01`, it adds both VLANs of Netflix: the public one on the uplink to the router, and both on its two server ports.
- **A rule** for the router's switch chip caps UDP toward the block of Netflix at 1G. Then a flood aimed at Netflix can't fill the uplinks of everyone else.

The file writes out every name, address, VLAN ID, and port of Netflix by hand, so a search for `netflix` finds every one.

<<< @/../examples/colocation/tenants/index.ts

`tenants/index.ts` merges every tenant into one value. A new tenant joins the list.

## The router and the switch

<<< @/../examples/colocation/sites/dc-1/tor-01.ts

The switch writes only what is its own: its management VLAN, its uplink, and its address. `include: [tenants.parts]` takes from every tenant the part keyed by `tor-01`. So the VLANs and ports of Netflix join the switch as if they were written there.

<<< @/../examples/colocation/sites/dc-1/edge-01.ts

The router is the edge router, with `include: [tenants.parts]` too. The tenants' ACL rules are placed with `merge`, after the router's own two in `edge`.

<TryIt title="Send packets through the tenants' networks">

Here a second tenant, Akamai, has joined. It has a public network and a private one.

<TenantPath />

</TryIt>

Two tenants are as far apart as any two networks on the internet: the router routes traffic between their public VLANs. A tenant's private network is further still, because only the switch carries it, and only on that tenant's ports.

<Quiz
  question="The first server of Netflix sends a backup to its second server over netflix-private. Which devices does it pass?"
  :choices="['tor-01 only', 'tor-01, then edge-01, then tor-01 again', 'edge-01 only']"
  :answer="0"
  :why="['', 'That is how traffic between two different public networks goes. VLAN 2001 is not on the trunk, so the router never sees it.', 'The servers are not plugged into the router. Every port they have is on tor-01.']"
  explain="Both servers are on VLAN 2001, which exists only on tor-01. The switch passes the frames between the two ports, and nothing reaches the router."
/>

## The network file and its check

<<< @/../examples/colocation/circuit.ts

<<< @/../examples/colocation/lib/checks.ts

Circuit knows nothing about tenants, so it can't know that two tenants' blocks must not overlap. The example says it in a check of its own, `blocks_apart`, with the `address` helper: no two networks on one device overlap.

## Add a tenant

A new tenant, Akamai, wants one server on its public network. Copy `tenants/netflix.ts` to `tenants/akamai.ts`, and change every name, VLAN ID, address, and port to Akamai's. Then add `akamai` to `tenants/index.ts`. Each choice can clash with Netflix, and Circuit says how.

<TryIt title="Write the file of Akamai">

Each plan here is made against the example's own render, not read from a device.

<TenantJoin />

</TryIt>

When every choice is sound, the plan is exactly what the tenant's file promised. The router gets a VLAN interface and the two gateway addresses. The switch gets the VLAN, the port, and the VLAN added to the uplink. The lines of Netflix don't move.

Every clash stops `validate`, and each message says where it is:

- A port that two tenants write with two values.
- Two tenants' VLANs with one ID.
- Blocks that overlap, from the example's own check.

The port matters most. Without the stop, one tenant would silently take the other's port, and `10GE1/0/1` would lose the VLANs of Netflix. Instead Circuit gives both files, and the line in each.

<Quiz
  question="Akamai is given 10g-1, which Netflix already uses. Which step of the workflow catches it?"
  :choices="['Your editor, with a red line', 'circuit validate, with an error', 'Reading the plan from circuit diff, where 10GE1/0/1 loses the VLANs of Netflix']"
  :answer="1"
  :why="['10g-1 is a valid port name in each file, so the types are happy. It takes Circuit reading both files together.', '', 'There is no plan to read: diff reads the files first, and stops at the error.']"
  explain="Circuit merges every tenant's parts, sees 10g-1 written twice with two descriptions, and names both files. An error stops diff and apply, so the port never changes hands."
/>

## When a tenant leaves

A tenant leaves when you remove it from `tenants/index.ts`. The next apply takes away everything it had, everywhere, because the file is the whole truth. Say Akamai has joined, and then Netflix leaves. `circuit diff` plans 22 commands for the router and 19 for the switch. On the switch:

```text
tor-01: 19 command(s) in 4 step(s)
  VLANs no longer used
    - vlan 1001
    - vlan 2001
    - vlan batch 1001 2001
  interface 10GE1/0/1
    - port trunk allow-pass vlan 1001 2001
    - undo port trunk allow-pass vlan 1
    - port link-type trunk
    - description netflix server 1
    + shutdown
  interface 10GE1/0/2
    - port trunk allow-pass vlan 1001 2001
    - undo port trunk allow-pass vlan 1
    - port link-type trunk
    - description netflix server 2
    + shutdown
  interface 40GE1/0/1
    - port trunk allow-pass vlan 99 1001 to 1002
    + port trunk allow-pass vlan 99 1002
```

The ports of Netflix are shut, not left open for whoever plugs in next. On the router, its VLAN, interface, and addresses go. The switch-chip rules are replaced as a whole, because Circuit rewrites an ordered list in its new order rather than editing it in place. The block of Netflix, `198.51.100.8/29`, is free again. Before you hand it to someone else, wait until the old tenant's servers are really unplugged.

## Where to go from here

The example grows the same way it started. Another switch is another device file with `include: [tenants.parts]`, and each tenant's file gets a part keyed by that switch. When many tenants share one shape, a function in `lib/` may build their parts from their data. Whoever changes that function then needs to read TypeScript.

## Further reading

- [Data center glossary](https://www.datacentres.com/glossary): colocation, cross-connects, and other words of the trade.
- [Rack unit](https://en.wikipedia.org/wiki/Rack_unit): the size of 1U and the usual 42U rack.
- [Data centers 101](https://resources.telegeography.com/data-centers-101-technical-terms-you-should-know), from TeleGeography: cross-connects and rack density.

## In short

- A colocation hosts tenants' servers. It gives each tenant a public VLAN, a block of addresses with the router as gateway, ports, and if it wants, a private VLAN that stays on the switch.
- Each tenant is one file of parts, keyed by device. Each device takes them with `include: [tenants.parts]`.
- Circuit stops a port or a VLAN that two tenants give two values. Your own check stops blocks that overlap. The plan shows the rest, so read it.
- Removing a tenant from the list removes everything it had, and shuts its ports.
