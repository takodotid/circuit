---
title: What an ISP sells
description: Broadband, DIA, IP transit and IX transit, told apart by who buys them and what is promised. Work out a 95th percentile bill from real samples.
---

# What an ISP sells

An internet provider sells the same thing to everyone, a way to the rest of the internet, but in different products for different buyers. Homes buy **broadband**: shared, and best effort. Businesses that need a rate they can count on buy **DIA**, dedicated internet access, with a committed rate and a service level agreement. Other networks, with their own AS numbers and addresses, buy **IP transit**, and some buy only part of it, **IX transit**.

The products differ in four things: whether the capacity is shared, what is promised in the contract, whose addresses the customer uses, and how the bill is worked out.

## Broadband: shared and best effort

Broadband is what a home, and many small shops, buy. Three things set it apart.

**It is shared.** The homes on a street share the provider's capacity, from the splitter of a [GPON tree](/academy/professional/last-mile) up to the provider's links to the internet. The provider sells more than it has, because homes are rarely all busy at once. How much more is the <Term means="How much capacity is sold, compared with how much there is to share. 40 homes sold 100 Mbit/s each on a 1,000 Mbit/s link is a contention ratio of 4 to 1.">contention ratio</Term>, and when many homes are busy, as in the evening, each gets less.

**It is best effort.** The plan says "up to 100 Mbit/s": that is the most a home gets, not a promise. The provider does its best, and commits to no rate.

**It sits behind the provider's gateway.** Often the home router logs in with a username and password over <Term means="PPP over Ethernet, RFC 2516: a session from the customer's router to the provider's gateway, which carries a login and hands out the address.">PPPoE</Term>. The session ends at the provider's <Term means="Broadband network gateway: the provider's router where home sessions end. It checks the login, gives the address, and applies the plan's speed. Older networks call it a BRAS.">BNG</Term>, the broadband network gateway, which checks the login, hands out the address, and keeps the home to its plan's speed. Some providers use plain DHCP instead of PPPoE, but the BNG does the same job.

The address a home gets is often not a public one. With <Term means="Carrier-grade NAT: NAT run by the provider, so many customers share one public IPv4 address.">CGNAT</Term>, the provider runs NAT for many customers at once, so they share public IPv4 addresses, as the devices in a home do in [Sharing one address](/academy/elementary/nat). If your router's internet address starts with 100.64 to 100.127, that is the range set aside for it, `100.64.0.0/10`. Nobody outside can reach a camera or a game server in that home directly, because the public address is not the home's alone.

## DIA: a committed rate

<Term means="Dedicated internet access: business internet with a committed rate, usually the same in both directions, and a service level agreement.">DIA</Term>, dedicated internet access, is what a business buys when it needs to count on its connection. The difference is in what is promised:

- **A committed rate.** If the contract says 100 Mbit/s, the provider plans its network so that 100 Mbit/s is there at every hour. This is the <Term means="Committed information rate: the rate a provider guarantees, as opposed to the rate a customer may burst to when there is room.">CIR</Term>, the committed information rate. It is usually the same in both directions, where broadband often uploads far slower than it downloads.
- **A service level agreement.** The <Term means="Service level agreement: what the provider promises in the contract, such as uptime and repair time, and what it owes if it misses.">SLA</Term> promises things such as how many hours a year the service may be down and how fast a fault is fixed, and what the provider owes, such as a refund, when it misses.
- **Fixed public addresses.** The customer gets a block from the provider's own space, routed to it. If the customer moves to another provider, the addresses stay behind.

It usually comes over a [fibre of its own](/academy/professional/last-mile#a-fibre-of-its-own). Some providers also sell business plans that are broadband underneath with a business contract on top; read what the contract commits to before calling it DIA.

<TryIt title="Bring the street online">

40 homes are on broadband plans of up to 100 Mbit/s, and one business buys 100 Mbit/s of DIA on the same uplink. Bring more homes online, and watch who slows down.

<SharedUplink />

</TryIt>

The homes share what is left after the committed rate, and slow down as more of them are busy. The business never notices: its 100 Mbit/s was kept aside. That is what it pays more for. The numbers in the widget are made up to be easy to follow; real contention ratios vary by provider and plan.

<Quiz
  question="An office runs its phones and video calls over the internet, and needs 50 Mbit/s up at every hour, with repairs within hours. What should it buy?"
  :choices="['Broadband of up to 300 Mbit/s, which is faster', 'DIA with a committed rate of 50 Mbit/s and an SLA', 'IP transit']"
  :answer="1"
  :why="['Up to 300 is the most it gets, not a promise, and broadband often uploads far slower than it downloads. Nothing in the contract covers the evening, or the repair time.', '', 'IP transit is sold to networks that bring their own AS number and addresses, and run BGP. An office does not need that.']"
  explain="DIA commits to the rate in both directions and puts the repair time in an SLA. A faster best-effort plan promises neither."
/>

## IP transit: selling to other networks

<Term means="A connection to the whole internet sold to another network, which brings its own AS number and addresses and runs BGP with the provider.">IP transit</Term> is sold to networks: smaller internet providers, hosting companies, content networks. The customer has its own AS number and its own addresses, as your network did in [Project: an edge router](/academy/intermediate/project-edge-router). What changes from DIA:

- **The customer runs BGP with the provider.** It announces its own prefixes, and the provider passes them on to the rest of the internet.
- **The provider sends routes back**: every route it knows, the full table, or only a default route, as the customer asks.
- **The addresses are the customer's own.** It can buy transit from two providers at once and announce the same prefixes to both, which is how a network stays up when one provider fails.

From the provider's side, the customer is a downstream, a network that buys transit from it: its routes go to everyone, as in [Networks of networks](/academy/intermediate/autonomous-systems). Before announcing them, the provider must check the prefixes really are the customer's.

## IX transit: only what the exchange has

Many of the networks people use most, content networks and cloud providers, are at the internet exchanges. A provider that is at those exchanges can sell <Term means="Only the routes a provider learns at internet exchanges, plus its own customers' routes, sold to another network. Also called partial transit.">IX transit</Term>: the routes it learns there, and its own customers', but not the routes from its own transit providers.

The buyer gets the exchange's networks without joining the exchange itself: no port at the exchange, no rack in its building, no sessions to set up with each member. It still needs ordinary transit for the rest of the internet, so IX transit is bought beside full transit, for the traffic to the exchange's networks.

| Product    | Bought by                  | Shared?       | Addresses                          | BGP                       | Usually billed by                           |
| ---------- | -------------------------- | ------------- | ---------------------------------- | ------------------------- | ------------------------------------------- |
| Broadband  | Homes, small shops         | Yes           | The provider's, often behind CGNAT | No                        | A fixed price for the plan                  |
| DIA        | Businesses                 | No, committed | The provider's                     | Not needed                | The committed rate                          |
| IP transit | Networks with their own AS | No, committed | The customer's                     | Yes, the whole internet   | A commit, plus burst at the 95th percentile |
| IX transit | Networks with their own AS | No, committed | The customer's                     | Yes, exchange routes only | Like IP transit                             |

## How transit is billed: the 95th percentile

Transit is often sold with a <Term means="The rate a customer agrees to pay for every month, whether it uses it or not.">commit</Term>: the customer agrees to pay for, say, 200 Mbit/s every month, on a port that can carry far more. Traffic above the commit is <Term means="Traffic above the commit, which the port allows and the contract bills at its burst rate.">burst</Term>, billed at the rate in the contract. To decide how much burst there was, providers usually use the **95th percentile**:

1. Every five minutes, the provider records the port's average rate over those five minutes. A 30-day month has 8,640 samples.
2. At the end of the month, the samples are sorted from the busiest down.
3. The busiest 5 percent are thrown away: 432 of 8,640.
4. The highest sample left, the 433rd, is the rate billed for the month.

So the customer may run flat out for the busiest 36 hours of the month, 5 percent of 720 hours, and pay nothing for them. Providers count each direction, and a common way is to work out the 95th percentile for traffic in and for traffic out, and bill the higher. Your contract says which.

<TryIt title="Work out a 95th percentile bill">

Here is one evening on a transit port: 40 samples instead of a month's 8,640, so you can see each one. Guess where the bill lands, then work it out in three steps. Then add a burst, one five-minute sample at a time.

<PercentileBill />

</TryIt>

With 40 samples, 5 percent is 2. A burst of one or two samples is thrown away with the rest of the busiest, and changes the bill by only a few Mbit/s. A third sample of it no longer fits in the busiest 5 percent, so the whole evening is billed at 600 Mbit/s, the burst's own speed. A month works the same way, with 432 samples to throw away.

<Quiz
  question="Your transit port runs a backup at 900 Mbit/s for 30 minutes every night of a 30-day month. The rest of the time it carries under 300 Mbit/s. Does the backup set your 95th percentile?"
  :choices="['Yes, the bill is 900 Mbit/s', 'No, the bill stays under 300 Mbit/s']"
  :answer="1"
  :why="['Count the samples: 30 minutes is 6 samples a night, 180 in the month. The busiest 432 are thrown away.', '']"
  explain="30 minutes a night is 6 five-minute samples, and 180 over 30 nights. All 180 are among the busiest 432 that are thrown away, so the bill is set by the ordinary traffic. A backup of more than 72 minutes a night would start to count."
/>

## IP transit and IX transit in Circuit

In Circuit, the two products differ only in what the router sends the customer: its export policy. Selling full transit, the export accepts everything:

```ts
// What the customer pays for: the whole internet, every route we know.
"ACME-OUT": [{ description: "The full table", action: "accept" }],
```

Selling IX transit, it accepts only routes the router tagged as learned at an exchange or from another customer, and your own space:

```ts
"ACME-OUT": [
    { description: "Learned at an exchange", match: { large_community: communities.learned_from.exchange }, action: "accept" },
    { description: "Our other customers", match: { large_community: communities.learned_from.customer }, action: "accept" },
    { description: "Our IPv4", match: { prefix: OURS.v4 }, action: "accept" },
    { description: "Our IPv6", match: { prefix: OURS.v6 }, action: "accept" },
    { description: "Nothing from the transit", action: "reject" },
],
```

The IX transit customer's prefixes also go only to the exchange, not to your own transit, because it did not buy a way in from the whole internet. [Selling IP transit](/use-cases/ip-transit) and [Selling IX-only transit](/use-cases/ix-transit) walk through both routers in full, including how the routes are tagged with communities and what to check before taking a customer's prefixes.

## Further reading

- [Contention ratio](https://en.wikipedia.org/wiki/Contention_ratio): shared capacity, and why busy hours are slower.
- [RFC 2516](https://www.rfc-editor.org/rfc/rfc2516): PPP over Ethernet.
- [Broadband Remote Access Server](https://2020.mmnog.net/pdf/20T205%20BRAS.pdf), MMNOG 2020: what a BNG does, and why it was once called a BRAS.
- [RFC 6598](https://www.rfc-editor.org/rfc/rfc6598): the `100.64.0.0/10` range for carrier-grade NAT, and [RFC 6888](https://www.rfc-editor.org/rfc/rfc6888): what carrier-grade NAT must do, and what it breaks.
- [Dedicated Internet Access: an explanation](https://fiberguide.net/dedicated-internet-access/), Fiber Guide: DIA against broadband, and why to read the contract.
- [Committed information rate](https://en.wikipedia.org/wiki/Committed_information_rate) and [Service-level agreement](https://en.wikipedia.org/wiki/Service-level_agreement): what is committed and what is promised.
- [IP transit](https://en.wikipedia.org/wiki/IP_transit): full table or default route, and the commit.
- William B. Norton, [Partial-route internet transit](https://drpeering.net/HTML_IPP/chapters/ch11-07-Partial-Route-Internet-Transit/ch11-07-Partial-Route-Internet-Transit.html), DrPeering: selling the routes learned at an exchange.
- [Burstable billing](https://en.wikipedia.org/wiki/Burstable_billing): the 95th percentile, step by step, and the ways of counting both directions.

## In short

- Broadband is shared and best effort: "up to" a speed, behind the provider's BNG, often over PPPoE and behind CGNAT.
- DIA commits to a rate, usually the same both ways, with an SLA and fixed addresses from the provider.
- IP transit is sold to networks with their own AS and addresses, over BGP; IX transit sells only the routes from the exchanges and the provider's customers.
- Transit is often billed by a commit and the 95th percentile: sort a month of five-minute samples, throw away the busiest 5 percent, and bill the highest one left.
