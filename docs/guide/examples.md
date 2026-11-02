# Example projects

Four whole projects, each in [`examples/`](https://github.com/takodotid/circuit/tree/v1/examples) in Circuit's repository. Each passes the editor's types and `circuit validate`, tested on every change to Circuit. Copy the one closest to your network, then change the names and addresses to your own.

The addresses and AS numbers are the ones kept for documentation (RFC 5737, RFC 3849, RFC 5398), so none of them is anybody's real network.

## A single site

A home, an office or an internal network: a router and a switch, three VLANs, DHCP, and a firewall. No BGP.

::: code-group

<<< @/../examples/single-site/circuit.ts
<<< @/../examples/single-site/sites/home/site.ts
<<< @/../examples/single-site/sites/home/router.ts
<<< @/../examples/single-site/sites/home/switch.ts
<<< @/../examples/single-site/lib/checks.ts

:::

## An edge router

Your own AS: one router with an IP transit and an internet exchange, a filter on what comes in and what goes out, and BGP communities.

::: code-group

<<< @/../examples/edge-router/circuit.ts
<<< @/../examples/edge-router/sites/pop-1/edge-01.ts

:::

## Colocation with tenants

A router and a top-of-rack switch. Each tenant's VLANs, gateway, ports and rules are in its own file, and each device takes them with `include`. See [Parts and merge](/guide/parts).

::: code-group

<<< @/../examples/colocation/circuit.ts
<<< @/../examples/colocation/tenants/acme.ts
<<< @/../examples/colocation/tenants/index.ts
<<< @/../examples/colocation/sites/dc-1/site.ts
<<< @/../examples/colocation/sites/dc-1/edge-01.ts
<<< @/../examples/colocation/sites/dc-1/tor-01.ts

:::

## An internet exchange

Two fabric switches that carry one peering LAN. Each member's port is in the member's own file. Circuit configures the switches; the route servers run their own software.

::: code-group

<<< @/../examples/internet-exchange/circuit.ts
<<< @/../examples/internet-exchange/members/member-a.ts
<<< @/../examples/internet-exchange/members/index.ts
<<< @/../examples/internet-exchange/sites/ix-1/site.ts
<<< @/../examples/internet-exchange/sites/ix-1/ix-sw-01.ts
<<< @/../examples/internet-exchange/lib/checks.ts

:::
