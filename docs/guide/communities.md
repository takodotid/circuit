# BGP communities

A BGP community is a tag on a route. Networks use them for two things:

1. **To remember where a route came from.** Your router tags each route it learns, for example "learned from a transit, in Jakarta, from AS6939". Your own policies can then treat routes differently by where they came from.
2. **To let a neighbor ask for something.** A customer, for example, tags a route it sends you with "do not announce this to AS6939", and your router does it.

For this to work, three things must agree: the tags your routers add, the tags your routers act on, and the list you publish so others know what each tag means. `communityScheme` builds all three from one definition, so they cannot drift apart.

## How a community is written

`communityScheme` uses large communities, which are three numbers: `asn:function:parameter`.

| Part        | What it is                                                      | Example                     |
| ----------- | --------------------------------------------------------------- | --------------------------- |
| `asn`       | Your AS number. Every community of yours starts with it.        | `64500`                     |
| `function`  | What the community means. You choose a number for each meaning. | `100`, "do not announce to" |
| `parameter` | What it applies to, such as an AS number or a site.             | `6939`                      |

So `64500:100:6939` reads "AS64500's function 100, toward AS6939": do not announce to AS6939.

## Defining the scheme

```ts
// routing.ts
import { communityScheme } from "@takodotid/circuit/presets";

export const communities = communityScheme({
    asn: 64500,
    learned_from: { function: 1, classes: { transit: 1, exchange: 2, customer: 3 } },
    learned_at: { function: 2, sites: { 0: "Jakarta" } },
    learned_from_as: 3,
    do_not_announce: 100,
    prepend: { once: 101, twice: 102, three_times: 103 },
    blackhole: { function: 666, upstreams: { 6939: "65535:666" } },
});
```

Every field except `asn` is optional. Leave out a meaning your network does not offer, and nothing is made for it.

### Where a route came from

Your router adds these on import. A neighbor can never set them, because the router removes any it sends.

| Field             | What you give                                                                                                         | The community it makes    |
| ----------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| `learned_from`    | `function`, and `classes`: a name and a number for each kind of neighbor, such as `transit: 1`. You choose the names. | `64500:1:1` for a transit |
| `learned_at`      | `function`, and optionally `sites`: a name for each site number, used only in the published list.                     | `64500:2:0` for site 0    |
| `learned_from_as` | The function number. The parameter is the neighbor's AS.                                                              | `64500:3:6939`            |

### What a neighbor can ask for

A neighbor adds these to the routes it sends you, to ask you for something. Only a neighbor you trust may ask; see [tag](#tag).

| Field             | What you give                                                                            | What the neighbor sets, and what happens                                                                                      |
| ----------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `do_not_announce` | The function number                                                                      | `64500:100:6939`: the route is not announced to AS6939. `64500:100:0`: it is not announced to anyone.                         |
| `prepend`         | A function number for each of `once`, `twice` and `three_times`; give the ones you offer | `64500:101:6939`: your AS is added once more to the path toward AS6939, so that route looks longer and less attractive there. |
| `blackhole`       | `function`, and `upstreams`                                                              | `64500:666:0`: drop all traffic to this route. See [Blackhole](#blackhole).                                                   |

## What you get back

`communityScheme` returns five things:

| Name                                 | What it is                                              | Where it goes                                |
| ------------------------------------ | ------------------------------------------------------- | -------------------------------------------- |
| `tag(class, asn, { site, trusted })` | One rule that tags a route as it comes in               | Each neighbor's import policy                |
| `actions(asn)`                       | Rules that do what neighbors asked, toward one neighbor | Each neighbor's export policy                |
| `blackhole(prefixSet)`               | One rule that takes a blackhole request                 | The import of each neighbor you allow, first |
| `catalogue`                          | Every community with its meaning                        | `communities` in `defineNetwork`             |
| `community(function, parameter)`     | One community, written out                              | A rule of your own                           |

### tag

```ts
communities.tag("transit", 6939, { site: 0 });
communities.tag("customer", 65550, { site: 0, trusted: true });
```

| Argument  | What it is                                                                                                       |
| --------- | ---------------------------------------------------------------------------------------------------------------- |
| `class`   | Which kind of neighbor this is, one of the names in `learned_from.classes`. The editor only accepts those names. |
| `asn`     | The neighbor's AS number.                                                                                        |
| `site`    | The number of the site the router is at. Needed when the scheme has `learned_at`; otherwise leave it out.        |
| `trusted` | `true` if this neighbor may ask you for something. Leave it out for everyone else.                               |

It does two things to every route from that neighbor:

1. **It removes your communities that the neighbor put on the route.** Nobody may fake your "where it came from" tags, so those are always removed. A neighbor that is not `trusted` loses its requests too, so a transit can never tell your router what to do with your routes.
2. **It adds where the route came from.**

Trust is per neighbor, not per class, because not every NOC is equally careful. Two customers can be treated differently: trust the one whose NOC you know, and leave the other out until you do.

Put it in each import, after the filters that decide whether to accept the route:

```ts
"TRANSIT-IN": [{ call: "SANITY" }, communities.tag("transit", 6939, { site: 0 }), { action: "accept" }],
"CUSTOMER-IN": [
    { call: "SANITY" },
    communities.tag("customer", 65550, { site: 0, trusted: true }),
    { description: "Only their own prefixes", match: { prefix_set: "customer-prefixes" }, action: "accept" },
    { action: "reject" },
],
```

### actions

```ts
communities.actions(6939);
```

`asn` is the AS of the neighbor this export goes to. For that neighbor, it makes these rules, in this order:

1. Reject a route tagged `64500:100:0`, "do not announce to anyone", and one tagged `64500:100:6939`, "do not announce to AS6939".
2. A blackholed route, tagged `64500:666:0`: passed on to this neighbor with its own blackhole community if it is in `blackhole.upstreams`, and rejected otherwise. See [Blackhole](#blackhole).
3. Prepend once, twice or three times for a route tagged `64500:101:6939`, `64500:102:6939` or `64500:103:6939`.
4. Remove every community of yours, so your tags stay inside your network.

Put them at the start of each export, before the rules that accept your routes:

```ts
"TRANSIT-OUT": [
    ...communities.actions(6939),
    { description: "Announce our block", match: { prefix: "198.51.100.0/24" }, action: "accept" },
    { description: "Nothing else leaves", action: "reject" },
],
```

### catalogue

The list for `circuit communities`, which prints it in the format looking glasses and bgp.tools read:

```ts
export default defineNetwork({ devices, asn: 64500, communities: communities.catalogue });
```

```
64500:1:1,Learned from a transit
64500:1:2,Learned from an exchange
64500:1:3,Learned from a customer
64500:2:0,Learned in Jakarta
64500:2:nnn,Learned at site $0
64500:3:nnn,Learned from AS$0
64500:100:0,Do not announce to anyone
64500:100:nnn,Do not announce to AS$0
64500:101:nnn,Prepend once to AS$0
64500:102:nnn,Prepend twice to AS$0
64500:103:nnn,Prepend three times to AS$0
64500:666:0,Blackhole: dropped in AS64500 and by its upstreams that take it
```

`nnn` stands for any number, and `$0` for the number it matched. See [Publishing the network](/guide/publishing#bgp-communities) for the format.

To publish a community the scheme does not make, add it beside the catalogue:

```ts
communities: [...communities.catalogue, { community: communities.community(200, 0), description: "Our own test routes" }],
```

### community

`communities.community(1, 3)` writes `64500:1:3`. Use it in a rule of your own, so a community is never typed by hand. For example, to prefer routes learned from customers over the same routes from anyone else:

```ts
{ description: "Customers first", match: { large_community: communities.community(1, 3) }, set: { local_pref: 300 } },
```

## Blackhole

A customer is under a DDoS attack on one address, `192.0.2.10`. The attack is filling its link. It asks you to drop all traffic to that address.

### What the customer does

It sends you a route for that one address, `192.0.2.10/32`, tagged with your blackhole community, `64500:666:0`. That is all. The customer never needs to know which upstreams you have, or their communities.

### What your network does

Two things, both automatic once set up:

1. **Your router drops the traffic.** Nothing to `192.0.2.10` reaches the customer any more, so its link is free.
2. **Your upstreams drop it too, if they offer blackholing.** The attack still arrives from the internet, over your own links to your upstreams. So the route goes on to each upstream in `blackhole.upstreams`, tagged with that upstream's own blackhole community instead of yours. That upstream drops the traffic in its own network, and your links are free as well. An upstream that does not offer blackholing never receives the route, because it would only keep sending the traffic to you.

| Where the traffic is dropped | When                                    |
| ---------------------------- | --------------------------------------- |
| Your router                  | Always                                  |
| An upstream in `upstreams`   | When its NOC gave you its own community |
| Any other upstream           | Never: it does not receive the route    |

### What you set up

**Once, in the scheme:** your blackhole community, and each upstream that offers blackholing, with the community its NOC gave you. `65535:666`, from RFC 7999, is common.

```ts
blackhole: { function: 666, upstreams: { 6939: "65535:666" } },
```

**For each neighbor you allow to blackhole:** this rule, first in its import.

```ts
"CUSTOMER-IN": [
    communities.blackhole("customer-prefixes"),
    { call: "SANITY" },
    communities.tag("customer", 65550, { site: 0, trusted: true }),
    { description: "Only their own prefixes", match: { prefix_set: "customer-prefixes" }, action: "accept" },
    { action: "reject" },
],
```

- It comes before `SANITY`, because `bgpSanity()` refuses anything longer than a /24, and a blackholed address is usually a /32.
- It only takes an address inside `customer-prefixes`, the customer's own space, so a customer can never blackhole someone else's address.
- Leave it out for a neighbor you do not allow to blackhole.

The exports need nothing extra: `actions` already passes the route on to the upstreams in `upstreams`, and holds it back from everyone else.
