# Selling IX-only transit

IX-only transit gives a customer only the routes you learn at internet exchanges, not the whole internet. It is often sold as "content" or domestic transit, because the big content networks, such as CDNs, video and cloud providers, are usually at the exchanges. It costs you little to carry, since exchange traffic does not go over your paid transit, so you can sell it cheaper than full transit. The customer buys full transit somewhere else and uses yours for the content.

This page is [Selling IP transit](/use-cases/ip-transit) with two policies changed. Read that page first: the customer, its sessions and its import are the same.

## How the router tells routes apart

Every route the router learns is tagged with where it came from, by [`communities.tag`](/guide/communities#tag):

| Community   | Learned from          |
| ----------- | --------------------- |
| `64500:1:1` | the transit           |
| `64500:1:2` | an exchange           |
| `64500:1:3` | one of your customers |

So the export to the customer only has to look at the tag.

## What changes

1. **Export to the customer, `ACME-OUT`**, accepts:
    1. routes learned at an exchange, tagged `64500:1:2`, found with `communities.community(1, 2)`;
    2. routes of your other customers, tagged `64500:1:3`;
    3. your own prefixes.

    Everything else, which is everything from the transit, is rejected.

2. **Export to the transit, `TRANSIT-OUT`**, no longer carries the customer's prefixes. The customer did not buy a way in from the whole internet, only from the exchange.

3. **Export to the exchange, `IX-OUT`**, still carries the customer's prefixes, so the networks at the exchange send their traffic for the customer through you.

## The files

<<< @/../examples/use-cases/ix-transit/edge-01.ts

`routing.ts` is the same as for [IP transit](/use-cases/ip-transit#the-files).

<<< @/../examples/use-cases/ix-transit/circuit.config.ts

## Selling both

One router can sell both kinds to different customers. Give each customer its own export: the full table for a transit customer, the exchange routes for an IX-only one. Then, toward the transit, accept only the prefix sets of your full transit customers.
