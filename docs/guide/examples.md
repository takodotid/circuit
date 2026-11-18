---
description: Four whole projects to copy from, tested on every change to Circuit.
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

Your own AS with two routers. The first has IP transit from Hurricane Electric, peering at DE-CIX, filters both ways, and BGP communities. The second, on Junos, peers at AMS-IX, sells transit to a customer that takes only a default route, and has a few servers. Both routers check the source of what arrives with uRPF.

::: code-group

<<< @/../examples/edge-router/circuit.ts

<<< @/../examples/edge-router/sites/pop-1/edge-01.ts

<<< @/../examples/edge-router/sites/pop-2/edge-02.ts

:::

## Colocation with tenants

A router and a top-of-rack switch. Each tenant, here Netflix, has its own file with its VLANs, gateway, ports, and rules. Devices pull them in with `include`. See [Parts and merge](/guide/parts).

::: code-group

<<< @/../examples/colocation/circuit.ts

<<< @/../examples/colocation/tenants/netflix.ts

<<< @/../examples/colocation/tenants/index.ts

<<< @/../examples/colocation/sites/dc-1/site.ts

<<< @/../examples/colocation/sites/dc-1/edge-01.ts

<<< @/../examples/colocation/sites/dc-1/tor-01.ts

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
