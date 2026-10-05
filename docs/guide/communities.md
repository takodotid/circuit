# BGP communities

A BGP community is a tag on a route. Networks use them for two things:

1. **To remember where a route came from.** Your router tags each route it learns, for example "learned from a transit, in Jakarta, from AS64501". Your own policies can then treat routes differently by where they came from.
2. **To let customers ask for something.** A customer tags a route it sends you, for example "do not announce this to AS64501", and your router does it.

For this to work, three things must agree: the tags your routers add, the tags your routers act on, and the list you publish so others know what each tag means. `communityScheme` builds all three from one definition, so they cannot drift apart.

## How a community is written

`communityScheme` uses large communities, which are three numbers: `asn:function:parameter`.

| Part        | What it is                                                      | Example                     |
| ----------- | --------------------------------------------------------------- | --------------------------- |
| `asn`       | Your AS number. Every community of yours starts with it.        | `64500`                     |
| `function`  | What the community means. You choose a number for each meaning. | `100`, "do not announce to" |
| `parameter` | What it applies to, such as an AS number or a site.             | `64501`                     |

So `64500:100:64501` reads "AS64500's function 100, toward AS64501": do not announce to AS64501.

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
    blackhole: 666,
});
```

Every field except `asn` is optional. Leave out a meaning your network does not offer, and nothing is made for it.

### Where a route came from

Your router adds these on import. A neighbor can never set them, because the router removes any it sends.

| Field             | What you give                                                                                                         | The community it makes    |
| ----------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| `learned_from`    | `function`, and `classes`: a name and a number for each kind of neighbor, such as `transit: 1`. You choose the names. | `64500:1:1` for a transit |
| `learned_at`      | `function`, and optionally `sites`: a name for each site number, used only in the published list.                     | `64500:2:0` for site 0    |
| `learned_from_as` | The function number. The parameter is the neighbor's AS.                                                              | `64500:3:64501`           |

### What a customer can ask for

A customer adds these to the routes it sends you. Your router acts on them when the route leaves toward the AS they name.

| Field             | What you give                                                                            | What the customer sets, and what happens                                                                                                        |
| ----------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `do_not_announce` | The function number                                                                      | `64500:100:64501`: the route is not announced to AS64501. `64500:100:0`: it is not announced to anyone.                                         |
| `prepend`         | A function number for each of `once`, `twice` and `three_times`; give the ones you offer | `64500:101:64501`: your AS is added once more to the path toward AS64501, so that route looks longer and less attractive there.                 |
| `blackhole`       | The function number                                                                      | `64500:666:0` on a route inside their own space: traffic to it is dropped in your network, before it reaches them. See [blackhole](#blackhole). |

## What you get back

`communityScheme` returns five things:

| Name                             | What it is                                              | Where it goes                        |
| -------------------------------- | ------------------------------------------------------- | ------------------------------------ |
| `tag(class, asn, options)`       | One rule that tags a route as it comes in               | Each neighbor's import policy        |
| `actions(asn, { blackhole })`    | Rules that do what customers asked, toward one neighbor | Each neighbor's export policy        |
| `blackhole(prefixSet)`           | One rule that takes a customer's blackhole request      | Each customer's import policy, first |
| `catalogue`                      | Every community with its meaning                        | `communities` in `defineNetwork`     |
| `community(function, parameter)` | One community, written out                              | A rule of your own                   |

### tag

```ts
communities.tag("transit", 64501, { site: 0 });
```

| Argument      | What it is                                                                                                                                   |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `class`       | Which kind of neighbor this is, one of the names in `learned_from.classes`. The editor only accepts those names.                             |
| `asn`         | The neighbor's AS number.                                                                                                                    |
| `site`        | The number of the site the router is at. Needed when the scheme has `learned_at`; otherwise leave it out.                                    |
| `keepActions` | `true` for a customer, so the requests it set on its routes stay. Leave it out for anyone else: only a customer may ask you to do something. |

It makes this rule:

```json
{
    "description": "Learned from AS64501",
    "set": {
        "remove_communities": ["64500:*"],
        "remove_large_communities": ["64500:*:*"],
        "add_large_communities": ["64500:1:1", "64500:2:0", "64500:3:64501"]
    }
}
```

1. First it removes every community of yours the neighbor sent, so nobody outside can fake one. With `keepActions`, it only removes the "where it came from" ones, `64500:1:*`, `64500:2:*` and `64500:3:*`, and the customer's requests stay.
2. Then it adds where the route came from.

Put it in each import, after the filters that decide whether to accept the route:

```ts
"TRANSIT-IN": [{ call: "SANITY" }, communities.tag("transit", 64501, { site: 0 }), { action: "accept" }],
"CUSTOMER-IN": [
    { call: "SANITY" },
    communities.tag("customer", 64510, { site: 0, keepActions: true }),
    { description: "Only their own prefixes", match: { prefix_set: "customer-prefixes" }, action: "accept" },
    { action: "reject" },
],
```

### actions

```ts
communities.actions(64501);
```

`asn` is the AS of the neighbor this export goes to. `blackhole`, optional, is that neighbor's own blackhole community; see [passing a blackhole on](#passing-a-blackhole-on). For that neighbor, it makes these rules, in this order:

1. Reject a route tagged `64500:666:0`, blackholed: it stays in your network.
2. Reject a route tagged `64500:100:0`, "do not announce to anyone".
3. Reject a route tagged `64500:100:64501`, "do not announce to AS64501".
4. Prepend once, twice or three times for a route tagged `64500:101:64501`, `64500:102:64501` or `64500:103:64501`.
5. Remove every community of yours, so your tags stay inside your network.

Put them at the start of each export, before the rules that accept your routes:

```ts
"TRANSIT-OUT": [
    ...communities.actions(64501),
    { description: "Announce our block", match: { prefix: "198.51.100.0/24" }, action: "accept" },
    { description: "Nothing else leaves", action: "reject" },
],
```

### blackhole

When a customer is under attack, it can ask you to drop all traffic to one of its addresses, so the attack stops at your router instead of filling its link. It sends you that address, usually a /32 or a /128, tagged `64500:666:0`.

```ts
communities.blackhole("customer-prefixes");
```

`prefixSet` is the prefix set that holds the customer's own space. The rule only takes a route inside it, so a customer can never blackhole someone else's address. It makes this rule:

```json
{
    "description": "Blackhole, asked by the customer",
    "match": { "large_community": "64500:666:0", "prefix_set": "customer-prefixes" },
    "set": { "blackhole": true },
    "action": "accept"
}
```

Put it first in the customer's import, before `SANITY`: `bgpSanity()` refuses anything longer than a /24, and a blackholed address is usually a /32.

```ts
"CUSTOMER-IN": [
    communities.blackhole("customer-prefixes"),
    { call: "SANITY" },
    communities.tag("customer", 64510, { site: 0, keepActions: true }),
    { description: "Only their own prefixes", match: { prefix_set: "customer-prefixes" }, action: "accept" },
    { action: "reject" },
],
```

The router then drops traffic to that address itself, and `actions` makes sure the route is never announced to anyone.

### Passing a blackhole on

Dropping the traffic at your router protects the customer, but the attack still fills your own links from your upstreams. An upstream that offers blackholing can drop it before it reaches you. Each one has its own community for it, which you get from its NOC; `65535:666` from RFC 7999 is common.

Give it to `actions` for that neighbor:

```ts
"TRANSIT-OUT": [
    ...communities.actions(64501, { blackhole: "64501:666" }),
    // ...
],
```

For that neighbor, the reject in step 1 of [actions](#actions) is replaced by a rule placed after the "do not announce" ones: a blackholed route is announced to the neighbor with its blackhole community, and without any of yours. A customer who also asked not to be announced to that neighbor still is not. Every neighbor without the option keeps rejecting it.

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
64500:666:0,Blackhole: dropped in AS64500, not announced further
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
