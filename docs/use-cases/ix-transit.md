# Selling IX-only transit

IX-only transit gives a customer only the routes you learn at internet exchanges, not the whole internet. It is often sold as "content", because many content networks, such as CDNs and cloud providers, are at the exchanges.

The customer, its sessions and what you take from it are the same as in [Selling IP transit](/use-cases/ip-transit). Only what you send changes. [Tell your upstreams](/use-cases/ip-transit#tell-your-upstreams) applies too, for the exchange's route servers.

## How the router knows where a route came from

The router tags every route it learns with where it came from, using [`communities.tag`](/guide/communities#tag):

| Community   | Learned from          |
| ----------- | --------------------- |
| `64500:1:1` | the transit           |
| `64500:1:2` | an exchange           |
| `64500:1:3` | one of your customers |

So what you send the customer only has to look at the tag.

## What changes

1. **What you send the customer, `ACME-OUT`:**
    1. routes tagged `64500:1:2`, learned at an exchange;
    2. routes tagged `64500:1:3`, from your other customers;
    3. your own prefixes;
    4. nothing else, so nothing from the transit.
2. **What you send the transit:** only your own prefixes. The customer's prefixes do not go there, because it did not buy a way in from the whole internet.
3. **What you send the exchange:** your prefixes and the customer's, so the networks there reach the customer through you.

## The files

<<< @/../examples/use-cases/ix-transit/edge-01.ts

`routing.ts` is the one from [Selling IP transit](/use-cases/ip-transit#the-files).

<<< @/../examples/use-cases/ix-transit/circuit.config.ts

## Selling both

One router can sell both. Give each customer its own export, and send the transit only the prefixes of customers who bought full transit.
