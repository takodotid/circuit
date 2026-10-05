# Selling IP transit

IP transit is a connection to the whole internet. Your customer has its own AS and address space. It sends you its routes over BGP, you announce them to the rest of the internet, and you send it every route you know.

This page builds on [an edge router](/patterns/edge-router): the same router, which buys transit itself and peers at an exchange, now sells transit to a customer, Example Customer, AS64510.

## What you need from the customer

1. **Its AS number**, and its **prefixes**: the address blocks it will announce.
2. **Proof the prefixes are its own.** Check the registry records, the RIR's or an IRR's, and that its ROAs name its AS. Never accept a prefix you have not checked: you would be helping someone hijack it.
3. **A link between you**: a port, a VLAN, and a small subnet for the BGP session, here `203.0.113.4/30` and an IPv6 `/64`.

## What the router does

1. **One BGP session per family** with the customer, with `role: "customer"`. Both routers then reject a route leak, after RFC 9234.
2. **`max_prefixes: 10`.** A customer announces a handful of prefixes. If it suddenly sends thousands, it has made a mistake, and the session closes before your router takes them.
3. **Import, `ACME-IN`**, in this order:
    1. A blackhole request is taken first, but only inside the customer's own space. See [blackhole](/guide/communities#blackhole).
    2. `SANITY` refuses what should never be on the internet.
    3. `communities.tag(..., { keepActions: true })` tags the route as learned from a customer, and keeps the customer's requests, such as "do not announce to AS64502".
    4. Only the customer's own prefixes are accepted, from the prefix sets `acme-v4` and `acme-v6`. They get the highest local preference, so traffic to the customer always goes straight to it.
    5. Everything else is rejected.
4. **Export to the customer, `ACME-OUT`:** every route, the full table. If the customer only wants a default route instead, accept `0.0.0.0/0` and `::/0` and reject the rest.
5. **Export to your transit and exchange**: your own prefixes and the customer's. `communities.actions` comes first, so the customer's requests are followed toward each neighbor.
6. **The customer's space is protected like yours.** Traffic from outside that claims to come from it is dropped by `antiSpoofing`.

## The files

<<< @/../examples/use-cases/ip-transit/routing.ts

<<< @/../examples/use-cases/ip-transit/edge-01.ts

<<< @/../examples/use-cases/ip-transit/circuit.config.ts

The checks here leave out `exportsEndInReject`, because `ACME-OUT` ends by accepting everything on purpose.

## Prefixes that change

Write the customer's prefixes in `prefix_sets` when they rarely change. A customer with customers of its own announces more, and they change often. Then fetch them from a registry instead:

```ts
prefix_sets: {
    "acme-v4": { source: { registry: "ripe-stat", query: "AS64510", family: "ipv4" } },
},
```

and run `npx circuit refresh edge-01 --confirm` to put the current list on the router. See [refresh](/guide/commands#snapshot-diff-apply-and-refresh).

## Next

- Publish your communities with `npx circuit communities`, so the customer knows what it can ask for. See [BGP communities](/guide/communities).
- For a second customer, add a VLAN, a port, two neighbors, two prefix sets and its import, and add its prefix sets to each export.
