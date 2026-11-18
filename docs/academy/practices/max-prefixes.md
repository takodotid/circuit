---
title: A prefix limit on every session
description: Every BGP session closes when its neighbor sends far more routes than it should, so a leak stops at your edge.
---

# A prefix limit on every session

Every BGP session has a limit a little higher than the number of routes its neighbor should send, and closes when the neighbor goes over it.

## Why

A prefix limit is a fuse. A neighbor may leak routes, or send a full table by mistake. The session then closes before those routes spread through your network and fill your router's memory and its chip.

In the [June 2019 leak](/academy/practices/exports-end-in-reject#why), the provider that announced the leaked routes took thousands of them from one customer. A limit on that session would have closed it, and Cloudflare named limits as one of the fixes.

RFC 7454 sets the limit by who the neighbor is. For a peer, keep it lower than a full table, so the session closes if the peer suddenly sends one. For a transit, keep it higher than a full table, to protect the router's memory.

## In Circuit

`max_prefixes` goes on each neighbor, or on its group. When the neighbor sends more, the session closes, and it stays closed until you clear it. On RouterOS, `circuit bgp` shows why each session is down, and `circuit bgp --clear-limit` opens the closed ones again. If several closed at once, look for a leak upstream before you raise a limit.

Some platforms can also open the session again by itself after some seconds, with `{ limit, restart_after }`, or keep it up and only log a message, with `{ limit, warn_only: true }`. The [feature matrix](/reference/platforms#routing) says which. The example's second router does both:

<<< @/../examples/edge-router/sites/pop-2/edge-02.ts#prefix-limits

The [edge router example](/guide/examples#an-edge-router) sets a limit on each of its three sessions. Its transit:

<<< @/../examples/edge-router/sites/pop-1/edge-01.ts#transit

For a peer, use the limits its PeeringDB record recommends for IPv4 and IPv6. [BGP](/academy/intermediate/bgp) lets you try a limit on a session, and [Choosing a device](/academy/professional/choosing-hardware) shows how many routes a chip holds.

## Further reading

- [RFC 7454 (BCP 194)](https://www.rfc-editor.org/rfc/rfc7454), section 8: prefix limits.
- [The circuit command: bgp](/reference/cli#bgp).
