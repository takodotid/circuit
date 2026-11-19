---
title: "Project: a colocation"
description: Host tenants on Circuit's colocation example. Read how one small file per tenant becomes VLANs, gateways, and ports, then add a tenant yourself and read the plan.
---

# Project: a colocation

In this project you run the network of a <Term means="Renting space, power, and cooling in someone else's data center for your own servers and network equipment.">colocation</Term> business. Customers, the <Term means="A customer that gets its own networks inside yours, such as a colocation customer with its own servers in your racks.">tenants</Term>, put their servers in your racks, and you give each one its own network.

This is Circuit's [colocation example](/guide/examples#colocation-with-tenants). It adds a switch and tenants to the [edge router](/academy/intermediate/project-edge-router) you already built.

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
  sites/dc-1/tor-02.ts   the switch for small tenants
  tenants/tsukaeru.ts       one file per tenant
  tenants/index.ts       every tenant, merged
  lib/checks.ts          a check of your own
```

::: info The names in this project
As in the edge router, the transit is Hurricane Electric and the exchange is DE-CIX. Replace their addresses, AS numbers, and port names with what your providers give you.
:::

## A tenant is one file

<<< @/../examples/colocation/tenants/tsukaeru.ts

The file of the tenant Tsukaeru holds everything Tsukaeru has, on every device, as [parts](/guide/parts):

- **On the router**, `edge-01`, it adds the VLAN `tsukaeru-internet`, carried on the trunk to the switch. It also adds a VLAN interface with the gateways of Tsukaeru, the first address of each of its blocks.
- **On the switch**, `tor-01`, it adds both VLANs of Tsukaeru: the public one on the uplink to the router, and both on its two server ports.
- **A rule** for the router's switch chip caps UDP toward the block of Tsukaeru at 1G, so a flood aimed at Tsukaeru can't fill everyone else's uplinks.

The file writes out every name, address, VLAN ID, and port of Tsukaeru by hand, so a search for `tsukaeru` finds every one.

<<< @/../examples/colocation/tenants/index.ts

`tenants/index.ts` merges every tenant into one value. A new tenant joins the list.

## The router and the switch

<<< @/../examples/colocation/sites/dc-1/tor-01.ts

The switch writes only what is its own: its management VLAN, its uplink, and its address. `include: [tenants.parts]` takes from every tenant the part keyed by `tor-01`, as if it were written there.

<<< @/../examples/colocation/sites/dc-1/edge-01.ts

The router is the edge router, with `include: [tenants.parts]` too. The tenants' ACL rules are placed with `merge`, after the router's own two in `edge`. It is also the [route reflector](/academy/professional/ibgp-at-scale#route-reflectors) of the routers in halls 2 and 3.

<TryIt title="Send packets through the tenants' networks">

Here a second tenant, Kapsi, has joined. It has a public network and a private one.

<TenantPath />

</TryIt>

<Quiz
  question="The first server of Tsukaeru sends a backup to its second server over tsukaeru-private. Which devices does it pass?"
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

A new tenant, Kapsi, wants one server on its public network. Copy `tenants/tsukaeru.ts` to `tenants/kapsi.ts`, and change every name, VLAN ID, address, and port to Kapsi's. Then add `kapsi` to `tenants/index.ts`. Each choice can clash with Tsukaeru, and Circuit says how.

<TryIt title="Write the file of Kapsi">

<TenantJoin />

</TryIt>

Every clash stops `validate`, and each message says where it is:

- A port that two tenants write with two values.
- Two tenants' VLANs with one ID.
- Blocks that overlap, from the example's own check.

The port matters most: without the stop, one tenant would silently take the other's port.

<Quiz
  question="Kapsi is given 10g-1, which Tsukaeru already uses. Which step of the workflow catches it?"
  :choices="['Your editor, with a red line', 'circuit validate, with an error', 'Reading the plan from circuit diff, where 10GE1/0/1 loses the VLANs of Tsukaeru']"
  :answer="1"
  :why="['10g-1 is a valid port name in each file, so the types are happy. It takes Circuit reading both files together.', '', 'There is no plan to read: diff reads the files first, and stops at the error.']"
  explain="Circuit merges every tenant's parts, sees 10g-1 written twice with two descriptions, and names both files. An error stops diff and apply, so the port never changes hands."
/>

## When a tenant leaves

A tenant leaves when you remove it from `tenants/index.ts`. The next apply takes away everything it had, everywhere. Say Kapsi has joined, and then Tsukaeru leaves. `circuit diff` plans 22 commands for the router and 19 for the switch. On the switch:

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
    - description tsukaeru server 1
    + shutdown
  interface 10GE1/0/2
    - port trunk allow-pass vlan 1001 2001
    - undo port trunk allow-pass vlan 1
    - port link-type trunk
    - description tsukaeru server 2
    + shutdown
  interface 40GE1/0/1
    - port trunk allow-pass vlan 99 1001 to 1002
    + port trunk allow-pass vlan 99 1002
```

The ports of Tsukaeru are shut, not left open for whoever plugs in next. On the router, its VLAN, interface, and addresses go. The switch-chip rules are replaced as a whole, because Circuit rewrites an ordered list in its new order rather than editing it in place. The block of Tsukaeru, `198.51.100.8/29`, is free again, but wait until its servers are unplugged before you hand it to someone else.

## Where to go from here

Another switch is another device file with `include: [tenants.parts]`, and each tenant's file gets a part keyed by that switch. When many tenants share one shape, a function in `lib/` may build their parts from their data. Whoever changes that function then needs to read TypeScript.

## Further reading

- [Data center glossary](https://www.datacentres.com/glossary): colocation, cross-connects, and other words of the trade.
- [Rack unit](https://en.wikipedia.org/wiki/Rack_unit): the size of 1U and the usual 42U rack.
- [Data centers 101](https://resources.telegeography.com/data-centers-101-technical-terms-you-should-know), from TeleGeography: cross-connects and rack density.
