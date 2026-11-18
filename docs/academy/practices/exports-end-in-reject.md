---
title: Exports end in a reject
description: Every BGP export accepts only the routes you mean to announce, then rejects the rest, so your network never leaks routes.
---

# Exports end in a reject

Every BGP export accepts the routes you mean to announce, each by name, and ends in a rule that rejects every other route.

## Why

A route you learned from a provider or a peer must never go on to another provider or peer. If it does, it is a route leak: traffic between other networks starts to flow through yours, and your links fill up.

On June 24, 2019, a company passed more specific routes it had learned from one provider to its other provider, which announced them to the internet. At the worst point, Cloudflare lost about 15% of its global traffic. An export that accepted the company's own space and rejected the rest would have kept the leak in.

Circuit already rejects a route that no rule accepts. The last rule says so where a reviewer reads it.

## In Circuit

`exports_end_in_reject: true` in `circuit.ts` turns on the check. `circuit validate`, `diff`, and `apply` then stop on an export that doesn't end in a reject with no `if`. Exports to a neighbor with `role: "customer"` aren't checked, because a customer may buy every route you have.

The [edge router example](/guide/examples#an-edge-router) sends one export to its transit and to the exchange:

<<< @/../examples/edge-router/sites/pop-1/edge-01.ts#export

A neighbor without an `export_policy` is sent nothing. On RouterOS, `role` on each neighbor adds a second guard: both sides refuse a leaked route, as RFC 9234 describes.

[Route policies](/academy/intermediate/route-policy) shows a leak step by step, and [Checks](/guide/checks#built-in-checks) lists every built-in check.

## Further reading

- [Cloudflare's report on the June 2019 leak](https://blog.cloudflare.com/how-verizon-and-a-bgp-optimizer-knocked-large-parts-of-the-internet-offline-today/).
- [RFC 7908](https://www.rfc-editor.org/rfc/rfc7908): what counts as a route leak.
- [RFC 9234](https://www.rfc-editor.org/rfc/rfc9234): BGP roles.
