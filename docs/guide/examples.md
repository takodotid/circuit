---
description: Four whole projects to copy from, tested on every change to Circuit.
---

# Example projects

Four whole projects. Pick the one closest to your network, copy it, and change it to yours.

- They live in [`examples/`](https://github.com/takodotid/circuit/tree/v1/examples) and pass `circuit validate` on every change to Circuit.
- Providers and exchanges have real names, like Hurricane Electric (AS6939) and DE-CIX.
- Your own network is AS64500, and every address is a documentation range, so nothing clashes with real space.

## A single site

A home, an office or an internal network. A router, a switch, three VLANs, DHCP and a firewall. No BGP.

::: code-group

<<< @/../examples/single-site/circuit.ts
<<< @/../examples/single-site/sites/home/site.ts
<<< @/../examples/single-site/sites/home/router.ts
<<< @/../examples/single-site/sites/home/switch.ts
<<< @/../examples/single-site/lib/checks.ts

:::

## An edge router

Your own AS. One router, IP transit from Hurricane Electric, peering at DE-CIX, filters both ways, and BGP communities.

::: code-group

<<< @/../examples/edge-router/circuit.ts
<<< @/../examples/edge-router/sites/pop-1/edge-01.ts

:::

## Colocation with tenants

A router and a top-of-rack switch. Each tenant (here, Netflix) has its own file with its VLANs, gateway, ports and rules. Devices pull them in with `include`. See [Parts and merge](/guide/parts).

::: code-group

<<< @/../examples/colocation/circuit.ts
<<< @/../examples/colocation/tenants/netflix.ts
<<< @/../examples/colocation/tenants/index.ts
<<< @/../examples/colocation/sites/dc-1/site.ts
<<< @/../examples/colocation/sites/dc-1/edge-01.ts
<<< @/../examples/colocation/sites/dc-1/tor-01.ts

:::

## An internet exchange

Two switches carrying one peering LAN. Each member (Cloudflare, Google) has its own file with its port. Circuit runs the switches; the route servers run their own software.

::: code-group

<<< @/../examples/internet-exchange/circuit.ts
<<< @/../examples/internet-exchange/members/cloudflare.ts
<<< @/../examples/internet-exchange/members/index.ts
<<< @/../examples/internet-exchange/sites/ix-1/site.ts
<<< @/../examples/internet-exchange/sites/ix-1/ix-sw-01.ts
<<< @/../examples/internet-exchange/lib/checks.ts

:::
