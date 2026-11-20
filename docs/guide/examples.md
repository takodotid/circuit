---
description: Six whole projects to copy from, tested on every change to Circuit.
---

# Example projects

Copy the project closest to your network from [`examples/`](https://github.com/takodotid/circuit/tree/main/examples), and change it to yours. Each one passes `circuit validate` on every change to Circuit.

## A single site

A home, an office, or an internal network. It has a router, a switch, three VLANs, DHCP, and a firewall, but no BGP.

::: code-group

<<< @/../examples/single-site/circuit.ts

<<< @/../examples/single-site/sites/home/site.ts

<<< @/../examples/single-site/sites/home/router.ts

<<< @/../examples/single-site/sites/home/switch.ts

<<< @/../examples/single-site/lib/checks.ts

:::

## An edge router

Your own AS with two edge routers and a broadband gateway. The first edge router has IP transit from Hurricane Electric, peering at DE-CIX, filters both ways, BGP communities, and CGNAT for the access network's subscribers. The second, on Junos, peers at AMS-IX, sells transit to a customer that takes only a default route, and has a few servers. Both check the source of what arrives with uRPF. Behind the first, the broadband gateway serves homes on an OLT with PPPoE, and RADIUS checks each home.

::: code-group

<<< @/../examples/edge-router/circuit.ts

<<< @/../examples/edge-router/sites/pop-1/edge-01.ts

<<< @/../examples/edge-router/sites/pop-2/edge-02.ts

<<< @/../examples/edge-router/sites/pop-1/bng-01.ts

:::

## A backbone in two regions

Your AS in two regions, each a member AS of a BGP confederation with its own iBGP. The core routers, one on Junos and one on FortiOS, run eBGP between the regions, and transit providers see only your AS. IS-IS carries the loopbacks. Two branch offices reach the south region over IPsec tunnels.

::: code-group

<<< @/../examples/backbone/circuit.ts

<<< @/../examples/backbone/sites/north/core-01.ts

<<< @/../examples/backbone/sites/south/core-02.ts

:::

## An MPLS core

Two provider edge routers, one in each point of presence. IS-IS carries their loopbacks, and LDP gives each loopback a label, so traffic between them crosses the core by label. A bank has an office at each router, in its VRF `bank`. The two VRFs share a route target, and iBGP between the loopbacks carries their routes as VPN routes (L3VPN, RFC 4364). A clinic's two sites share one Ethernet segment: each site's port is in the VLAN `clinic` with a pseudowire to the other router (VPWS).

::: code-group

<<< @/../examples/mpls-core/circuit.ts

<<< @/../examples/mpls-core/sites/pop-1/pe-01.ts

<<< @/../examples/mpls-core/sites/pop-2/pe-02.ts

:::

## Colocation with tenants

A router, two top-of-rack switches, and the meet-me room's switch. The router is managed in a VRF of its own, and reaches its time, name, and monitoring servers in another. Each tenant, here Netflix, has its own file with its VLANs, gateway, ports, and rules, and a VRF that keeps its private network apart, with a BGP session over its private circuit. Devices pull them in with `include`. See [Parts and merge](/guide/parts). Small tenants share a subnet on the second switch, in a private VLAN that keeps their servers apart, and its port guards keep each tenant from harming the others. A tenant's own VLANs reach its racks in another hall inside one VLAN, with QinQ. Carriers hand off on the meet-me room's Raisecom switch: each port toward another network stays out of the spanning tree or its root, limits what it floods, and a tenant's transit is held to the rate the tenant pays for.

::: code-group

<<< @/../examples/colocation/circuit.ts

<<< @/../examples/colocation/tenants/netflix.ts

<<< @/../examples/colocation/tenants/index.ts

<<< @/../examples/colocation/sites/dc-1/site.ts

<<< @/../examples/colocation/sites/dc-1/edge-01.ts

<<< @/../examples/colocation/sites/dc-1/tor-01.ts

<<< @/../examples/colocation/sites/dc-1/tor-02.ts

<<< @/../examples/colocation/sites/dc-1/mmr-01.ts

:::

## An internet exchange

Two switches carry one peering LAN. Each member, such as Cloudflare or Google, has its own file with its port. Circuit runs the switches, and the route servers run their own software.

::: code-group

<<< @/../examples/internet-exchange/circuit.ts

<<< @/../examples/internet-exchange/members/cloudflare.ts

<<< @/../examples/internet-exchange/members/index.ts

<<< @/../examples/internet-exchange/sites/ix-1/site.ts

<<< @/../examples/internet-exchange/sites/ix-1/ix-sw-01.ts

<<< @/../examples/internet-exchange/lib/checks.ts

:::
