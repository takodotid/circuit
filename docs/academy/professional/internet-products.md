---
title: What an ISP sells
description: Broadband, DIA, IP transit, and IX transit, told apart by who buys them and what is promised. Work out a transit bill from five-minute samples.
---

# What an ISP sells

An internet provider sells everyone the same thing, a way to the rest of the internet. It sells it as different products to different buyers:

- Homes buy **broadband**, which is shared and best effort.
- Businesses that need a rate they can count on buy **DIA**, dedicated internet access. It comes with a committed rate and a service level agreement.
- Other networks, with their own AS numbers and addresses, buy **IP transit**. Some buy only part of it, **IX transit**.

## Broadband: shared and best effort

Homes and many small shops buy broadband. Three things set it apart.

**It is shared.** The homes on a street share the provider's capacity, from the splitter of a [GPON tree](/academy/professional/last-mile) up to the provider's links to the internet. The provider sells more than it has, because homes are rarely all busy at once. How much more is the <Term means="How much capacity is sold, compared with how much there is to share. 40 homes sold 100 Mbit/s each on a 1,000 Mbit/s link is a contention ratio of 4 to 1.">contention ratio</Term>. When many homes are busy, as in the evening, each gets less.

**It is best effort.** A plan of "up to 100 Mbit/s" is the most a home gets, not a promise. The provider does its best, and commits to no rate.

**It sits behind the provider's gateway.** Often the home router logs in with a username and password over <Term means="PPP over Ethernet, RFC 2516: a session from the customer's router to the provider's gateway, which carries a login and hands out the address.">PPPoE</Term>. The session ends at the provider's <Term means="Broadband network gateway: the provider's router where home sessions end. It checks the login, gives the address, and applies the plan's speed. Older networks call it a BRAS.">BNG</Term>, the broadband network gateway. The BNG checks the login, hands out the address, and keeps the home to its plan's speed. Some providers use plain DHCP instead of PPPoE, and the BNG does the same job.

The address a home gets is often not a public one. With <Term means="Rewriting addresses so many devices share one public address; CGNAT does it inside the provider, for many customers.">CGNAT</Term>, the provider runs NAT for many customers at once, so they share public IPv4 addresses. It is the same idea as the devices in a home sharing one address, from [Sharing one address](/academy/elementary/nat). If your router's internet address is between 100.64 and 100.127, it is behind CGNAT. That range, `100.64.0.0/10`, is set aside for it. Nobody outside can reach a camera or a game server in that home directly, because the public address isn't the home's alone.

## DIA: a committed rate

A business that needs to count on its connection buys <Term means="Dedicated internet access: a business connection with a committed rate and a service level agreement.">DIA</Term>, dedicated internet access. The difference is in what the contract promises:

- **A committed rate.** If the contract says 100 Mbit/s, the provider plans its network so that 100 Mbit/s is there at every hour. This is the <Term means="Committed information rate: the bandwidth a provider guarantees, as opposed to what you may burst to.">CIR</Term>, the committed information rate. It is usually the same in both directions, while broadband often uploads far slower than it downloads.
- **A service level agreement.** The <Term means="Service level agreement: what the provider promises, such as uptime and repair time, and what it owes if it misses.">SLA</Term> promises how many hours a year the service may be down, and how fast a fault is fixed. It also says what the provider owes, such as a refund, when it misses.
- **Fixed public addresses.** The customer gets a block from the provider's own space, routed to it. If the customer moves to another provider, the addresses stay behind.

DIA usually comes over a [fiber of its own](/academy/professional/last-mile#a-fiber-of-its-own). Some providers sell "business" plans that are broadband underneath with a business contract on top. Read what the contract commits to before you call it DIA.

<TryIt title="Bring the street online">

<SharedUplink />

</TryIt>

The business pays more so that its 100 Mbit/s is kept aside. Real contention ratios vary by provider and plan.

<Quiz
  question="An office runs its phones and video calls over the internet, and needs 50 Mbit/s up at every hour, with repairs within hours. What should it buy?"
  :choices="['Broadband of up to 300 Mbit/s, which is faster', 'DIA with a committed rate of 50 Mbit/s and an SLA', 'IP transit']"
  :answer="1"
  :why="['Up to 300 is the most it gets, not a promise, and broadband often uploads far slower than it downloads. Nothing in the contract covers the evening, or the repair time.', '', 'IP transit is sold to networks that bring their own AS number and addresses, and run BGP. An office does not need that.']"
  explain="DIA commits to the rate in both directions and puts the repair time in an SLA. A faster best-effort plan promises neither."
/>

## IP transit: selling to other networks

<Term means="A connection to the whole internet sold to another network, which brings its own AS number and addresses.">IP transit</Term> is sold to networks, such as smaller internet providers, hosting companies, and content networks. The customer has its own AS number and its own addresses, as your network did in [Project: an edge router](/academy/intermediate/project-edge-router). Three things change from DIA:

- **The customer runs BGP with the provider.** It announces its own prefixes, and the provider passes them on to the rest of the internet.
- **The provider sends routes back.** It sends either the full table (every route it knows) or only a default route, as the customer asks.
- **The addresses are the customer's own.** It can buy transit from two providers at once and announce the same prefixes to both. This way the network stays up when one provider fails.

To the provider, the customer is a downstream, a network that buys transit from it. Its routes go to everyone, as in [Networks of networks](/academy/intermediate/autonomous-systems). Before the provider announces them, it must check that the prefixes really are the customer's.

## IX transit: only what the exchange has

Many of the networks people use most, such as content networks and cloud providers, are at the internet exchanges. A provider at those exchanges can sell <Term means="Only the routes learned at internet exchanges, sold more cheaply than full transit.">IX transit</Term>. It carries the routes the provider learns there, and its own customers' routes, but not the routes from its own transit providers.

The buyer gets the exchange's networks without joining the exchange. It needs no port at the exchange, no rack in its building, and no session with each member. It still needs ordinary transit for the rest of the internet. So IX transit is bought beside full transit, for the traffic to the exchange's networks.

| Product    | Bought by                  | Shared?       | Addresses                          | BGP                       | Usually billed by          |
| ---------- | -------------------------- | ------------- | ---------------------------------- | ------------------------- | -------------------------- |
| Broadband  | Homes, small shops         | Yes           | The provider's, often behind CGNAT | No                        | A fixed price for the plan |
| DIA        | Businesses                 | No, committed | The provider's                     | Not needed                | The committed rate         |
| IP transit | Networks with their own AS | No, committed | The customer's                     | Yes, the whole internet   | A commit, plus any burst   |
| IX transit | Networks with their own AS | No, committed | The customer's                     | Yes, exchange routes only | Like IP transit            |

## How transit is billed

Transit is often sold with a <Term means="The rate a customer agrees to pay for every month, whether it uses it or not.">commit</Term>. The customer agrees to pay for, say, 200 Mbit/s every month, on a port that can carry far more. Traffic over the commit is <Term means="Traffic over the commit, which the port allows and the contract bills at its burst rate.">burst</Term>, billed at the burst rate in the contract. To measure the burst, providers usually bill the **ninety-fifth percentile**:

1. Every five minutes, the provider records the port's average rate over those five minutes. A 30-day month has 8,640 samples.
2. At the end of the month, the samples are sorted from the busiest down.
3. The busiest 5 percent are thrown away, 432 of 8,640.
4. The highest sample left, number 433, is the rate billed for the month.

So the customer may run flat out for the busiest 36 hours of the month, 5 percent of 720 hours, and pay nothing for them. Providers count each direction. A common way is to work out the percentile for traffic in and for traffic out, and bill the higher one. Your contract says which.

<TryIt title="Work out a transit bill">

One evening has 40 samples instead of a month's 8,640, so you can see each one. When you have the bill, add a burst one sample at a time.

<PercentileBill />

</TryIt>

A burst of one or two samples is thrown away with the rest of the busiest, and changes the bill by only a few Mbit/s. A third sample of it no longer fits in the busiest 5 percent, so the whole evening is billed at 600 Mbit/s, the burst's own speed. A month works the same way, with 432 samples to throw away.

<Quiz
  question="Your transit port runs a backup at 900 Mbit/s for 30 minutes every night of a 30-day month. The rest of the time it carries under 300 Mbit/s. Does the backup set your bill?"
  :choices="['Yes, the bill is 900 Mbit/s', 'No, the bill stays under 300 Mbit/s']"
  :answer="1"
  :why="['Count the samples: 30 minutes is 6 samples a night, 180 in the month. The busiest 432 are thrown away.', '']"
  explain="30 minutes a night is 6 five-minute samples, and 180 over 30 nights. All 180 are among the busiest 432 that are thrown away, so the bill is set by the ordinary traffic. A backup of more than 72 minutes a night would start to count."
/>

## IP transit and IX transit in Circuit

In Circuit, the two products differ only in what the router sends the customer, its export policy. For full transit, the export accepts everything:

```ts
// What the customer pays for: the whole internet, every route we know.
"netflix-export": [{ description: "The full table", then: "accept" }],
```

For IX transit, it accepts only your own space and the routes tagged as learned at an exchange or from another customer:

```ts
// 64500:1:2 tags routes learned from the exchange group, and 64500:1:3 from the customer group.
"netflix-export": [
    { description: "Learned at an exchange", if: { large_community: "64500:1:2" }, then: "accept" },
    { description: "Our other customers", if: { large_community: "64500:1:3" }, then: "accept" },
    { description: "Our own space", if: { prefix_set: "ours" }, then: "accept" },
    { description: "Nothing from the transit", then: "reject" },
],
```

You also announce the IX transit customer's prefixes only at the exchange, not to your own transit. The customer didn't buy a way in from the whole internet. [BGP communities](/guide/communities) shows how routes are tagged.

## Further reading

- [Contention ratio](https://en.wikipedia.org/wiki/Contention_ratio): shared capacity, and why busy hours are slower.
- [RFC 2516](https://www.rfc-editor.org/rfc/rfc2516): how PPP runs over Ethernet.
- [Broadband Remote Access Server](https://2020.mmnog.net/pdf/20T205%20BRAS.pdf), MMNOG 2020: what a BNG does, and why it was once called a BRAS.
- [RFC 6598](https://www.rfc-editor.org/rfc/rfc6598): the `100.64.0.0/10` range for carrier-grade NAT. [RFC 6888](https://www.rfc-editor.org/rfc/rfc6888): what carrier-grade NAT must do, and what it breaks.
- [Dedicated Internet Access: an explanation](https://fiberguide.net/dedicated-internet-access/), Fiber Guide: how DIA differs from broadband, and why to read the contract.
- [Committed information rate](https://en.wikipedia.org/wiki/Committed_information_rate) and [Service-level agreement](https://en.wikipedia.org/wiki/Service-level_agreement): what is committed and what is promised.
- [IP transit](https://en.wikipedia.org/wiki/IP_transit): the full table or a default route, and the commit.
- [Partial-route internet transit](https://drpeering.net/HTML_IPP/chapters/ch11-07-Partial-Route-Internet-Transit/ch11-07-Partial-Route-Internet-Transit.html), DrPeering: selling the routes learned at an exchange.
- [Burstable billing](https://en.wikipedia.org/wiki/Burstable_billing): percentile billing step by step, and the ways to count both directions.

## In short

- Broadband is shared and best effort, "up to" a speed. It sits behind the provider's BNG, often over PPPoE, and often behind CGNAT.
- DIA commits to a rate, usually the same both ways. It comes with an SLA and fixed addresses from the provider.
- IP transit is sold to networks with their own AS and addresses, over BGP. IX transit sells only the routes from the exchanges and the provider's customers.
- Transit is often billed by a commit and the ninety-fifth percentile. Sort a month of five-minute samples, throw away the busiest 5 percent, and bill the highest one left.
