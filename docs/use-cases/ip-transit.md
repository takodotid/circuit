# Selling IP transit

IP transit is a connection to the whole internet. The customer has its own AS and its own addresses. It sends you its routes over BGP, you pass them on to the rest of the internet, and you send it every route you know.

In the example, your router buys transit from Hurricane Electric, AS6939, peers at SGIX, AS55518, and sells transit to Acme, AS65550.

## Before you start

You need from the customer:

1. **Its AS number and its prefixes**, the address blocks it will announce.
2. **Proof that the prefixes are its own.** Check the registry records, and that its ROAs name its AS. Never take a prefix you have not checked, or you help someone hijack it.

You give the customer a link: a port, a VLAN, and a small subnet from your own space for the BGP session. In the example, `198.51.100.252/30`.

## Tell your upstreams

Your transit and the exchange's route servers do not take every route you send them. They filter your routes with a list built from your records in an IRR, an internet routing registry. Until the customer is in those records, its prefixes go nowhere, even though your router announces them.

1. Add the customer's AS to your AS-SET in the IRR, the list of networks you announce. Your upstreams know your AS-SET by name, for example `AS64500:AS-CUSTOMERS`.
2. Make sure the customer has a route object for each prefix, with its own AS as the origin, and a ROA.
3. Ask each upstream how it updates its filter. Most rebuild it from the IRR on their own, often once a day. Some want an email to their NOC with the new prefixes.

## What the router does

1. **Two BGP sessions with the customer**, one for IPv4 and one for IPv6, with `role: "customer"`. Both routers then reject a route leak on their own, after RFC 9234.
2. **`max_prefixes: 10`.** A customer announces a few prefixes. If it suddenly sends thousands, something went wrong on its side, and the session closes before your router takes them.
3. **What it takes from the customer, `ACME-IN`**, in this order:
    1. A blackhole request, but only for an address inside the customer's own space. See [blackhole](/guide/communities#blackhole).
    2. `SANITY`, which refuses routes that should never be on the internet.
    3. `communities.tag`, which tags the route as learned from a customer. The customer's own requests, such as "do not announce to AS55518", stay, because this customer is trusted: `trusted: true`.
    4. The customer's own prefixes, from the prefix sets `acme-v4` and `acme-v6`. They get the highest local preference, so traffic to the customer always goes straight to it.
    5. Nothing else.
4. **What it sends the customer, `ACME-OUT`:** every route it knows. For a customer that only wants a default route, accept `0.0.0.0/0` and `::/0` and reject the rest.
5. **What it sends the transit and the exchange:** your prefixes and the customer's. `communities.actions` comes first, so the customer's requests are followed.
6. **Spoofed traffic.** Traffic from outside that claims to come from the customer's space is dropped, like traffic that claims to come from yours.

## The files

<<< @/../examples/use-cases/ip-transit/routing.ts

<<< @/../examples/use-cases/ip-transit/edge-01.ts

<<< @/../examples/use-cases/ip-transit/circuit.config.ts

`exportsEndInReject` checks that every export ends by rejecting what it did not accept. `ACME-OUT` accepts everything on purpose, and the check leaves it alone, because it goes to a neighbor whose `role` is `customer`.

## Prefixes that change often

A customer with customers of its own announces many prefixes, and they change. Fetch them from a registry instead of writing them:

```ts
prefix_sets: {
    "acme-v4": { source: { registry: "ripe-stat", query: "AS65550", family: "ipv4" } },
},
```

Then `npx circuit refresh edge-01 --confirm` puts the current list on the router. See [refresh](/guide/cli#snapshot-diff-apply-and-refresh).
