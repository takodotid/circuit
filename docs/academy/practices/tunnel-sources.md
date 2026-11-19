---
title: Tunnels start outside what they carry
description: A GRE or VXLAN tunnel starts from an address outside every route you announce through it, so the far end never routes the tunnel into itself.
---

# Tunnels start outside what they carry

A GRE or VXLAN tunnel starts from an address outside every route you announce through that tunnel.

## Why

The far end reaches your end of the tunnel over the internet. If you announce a route through the tunnel that covers that address, the far end learns a more specific route to it: through the tunnel itself. The tunnel's own packets then go into the tunnel, and nothing arrives. The tunnel and its BGP session go down, and the route goes with them. Then the tunnel comes back up, and falls again. It keeps flapping.

## In Circuit

`tunnels_outside_offered: true` in `circuit.ts` turns on the check. For each GRE and VXLAN tunnel, it finds the BGP neighbors whose address is on the tunnel. It stops when the tunnel's `local_address` is inside a `prefix` or a `prefix_set` that their export accepts.

Start the tunnel from the address you reach the far end through, such as your end of the transit link. Here Terramix is sent `198.51.100.0/24` through the tunnel, and the tunnel starts from `203.0.113.2`, outside it:

```ts
interfaces: {
    gre: {
        terramix: {
            description: "Terramix",
            local_address: "203.0.113.2",
            remote_address: "203.0.113.200",
            addresses: ["203.0.113.253/30"],
        },
    },
},
routing: {
    bgp: {
        neighbors: {
            terramix: {
                address: "203.0.113.254",
                remote_as: 274016,
                role: "customer",
                import_policy: "terramix-import",
                export_policy: "terramix-export",
            },
        },
    },
    policies: {
        "terramix-export": [
            { description: "Our own space", if: { prefix: "198.51.100.0/24" }, then: "accept" },
            { description: "Nothing else", then: "reject" },
        ],
    },
},
```

Started from a loopback at `198.51.100.1` instead, the tunnel stops `validate`:

```text
  error  edge-01: interfaces.gre.terramix is sourced from 198.51.100.1, inside 198.51.100.0/24, which routing.bgp.neighbors.terramix is offered
```

[Separate networks on one](/academy/professional/vrfs-and-overlays) shows tunnels in Circuit, and [Checks](/guide/checks#built-in-checks) lists every built-in check.
