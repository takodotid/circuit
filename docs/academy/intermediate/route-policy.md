---
title: Route policies
description: Filter the routes you accept and announce with BGP route policies. Feed routes through an import, and see what a careless export does.
---

# Route policies

A route policy is a list of rules that every route passes through, from the top. On import, it decides which routes you accept from a neighbor and how you mark them. On export, it decides which routes you announce to that neighbor.

The rule for both is short: never accept everything, and never announce everything. Circuit starts from there. A neighbor without an `import` accepts nothing, and one without an `export` announces nothing.

## How a policy is read

In a device file, `policies` has named lists of rules, and each BGP neighbor says, by name, which list it uses for `import` and which for `export`. A rule can have four parts, and Circuit evaluates them in this order:

1. `call`: run another policy first. A route that policy accepts or rejects stops there.
2. `match`: which routes the rule applies to, such as a `prefix`, a `prefix_set`, a `prefix_length`, an `rpki` state or a `community`. A rule without `match` applies to every route.
3. `set`: what to change on the route, such as `local_pref` from [the last lesson](/academy/intermediate/best-path).
4. `action`: `accept` or `reject`, which ends the policy for that route.

A rule without `action` changes the route and moves on to the next rule. The first decision wins, and a route that no rule accepts is rejected.

## What to keep out

A neighbor can send you routes it should not, by mistake or on purpose. Four kinds should never reach your routing table:

1. **Addresses that are not on the internet**: private ranges such as `10.0.0.0/8`, and <Term means="Addresses that can never be a real destination on the internet, such as 127.0.0.0/8, the device itself, or 169.254.0.0/16, used only on one link.">martians</Term>. Circuit's presets list them as `Filters.PRIVATE_RANGES` and `Filters.MARTIANS`.
2. **Prefixes too long or too short**. Most networks accept nothing longer than a /24 for IPv4 or a /48 for IPv6, so a longer one would not travel far, and it only makes every table bigger. Nothing shorter than a /8 or a /16 is a real network either.
3. **Your own prefixes, coming back**. You already know where your own space is. A neighbor announcing it means someone else claims it, by mistake or to steal its traffic.
4. **Routes RPKI marks invalid**. With <Term means="Resource Public Key Infrastructure. The holder of a prefix publishes a signed record, a ROA, that says which AS may announce it, and routers check each route against those records.">RPKI</Term>, a validator compares each route with the published records: `valid` if a record allows it, `invalid` if one contradicts it, `not-found` if there is none. Your validators go in `routing.rpki`.

`Bgp.sanity()` from the [presets](/guide/presets#bgp-sanity) makes the rules for the second and fourth. The first and third need a `prefix_set` each, a named list of prefixes. A route matches a set when its prefix is one of the set's own, or inside one:

```ts
prefix_sets: {
    bogons: { prefixes: [...Filters.MARTIANS, ...Filters.PRIVATE_RANGES] },
    ours: { prefixes: ["198.51.100.0/24"] },
},

policies: {
    SANITY: Bgp.sanity(),
    "TRANSIT-IN": [
        { call: "SANITY" },
        { description: "Martians and private ranges", match: { prefix_set: "bogons" }, action: "reject" },
        { description: "Our own space, coming back", match: { prefix_set: "ours" }, action: "reject" },
        communities.tag("transit", 64510),
        { set: { local_pref: 100 } },
        { action: "accept" },
    ],
},
```

<TryIt title="Run routes through an import policy">

Feed the routes from a transit through TRANSIT-IN, one at a time, and watch which rule decides each. Then turn a rule off, start over, and count what gets in.

<PolicyFilter />

</TryIt>

Look at `203.0.113.128/25`. RPKI marks it invalid, but the rule that rejected it was the length check, because it comes first inside SANITY. The first decision wins, so a later rule never sees the route.

With SANITY off, the default route, the /25, the /64 and the RPKI invalid route all get in. With the last rule off, nothing gets in at all, not even the good routes: a route that no rule accepts is rejected. That is why every import ends in an explicit `{ action: "accept" }`, after everything that rejects.

<Quiz
  question="Your transit sends 192.168.40.0/22, and RPKI says not-found. Which rule of TRANSIT-IN rejects it?"
  :choices="['SANITY, because it is too long', 'Martians and private ranges', 'Our own space, coming back', 'None: it is accepted']"
  :answer="1"
  :why="['A /22 is between /8 and /24, so the length rules let it through, and not-found is not invalid.', '', 'Your own space is 198.51.100.0/24. This is private space.', 'It is inside 192.168.0.0/16, one of the private ranges in the bogons set.']"
  explain="A /22 passes the length checks, and not-found is not invalid, so SANITY lets it through. It is inside 192.168.0.0/16, which is in the bogons set, so the next rule rejects it."
/>

## What to announce

An export should accept your own prefixes, and your customers' if you sell them transit, and then reject everything else. The [edge router template](/patterns/edge-router) writes it like this, where `OURS` lists your own blocks:

```ts
OUT: [
    ...OURS.map((prefix) => ({ description: `Announce ${prefix}`, match: { prefix }, action: "accept" as const })),
    { description: "Nothing else leaves", action: "reject" },
],
```

Announcing more than that causes a <Term means="Routes learned from one provider or peer, announced to another one, so traffic between two other networks starts flowing through yours.">route leak</Term>: a small network suddenly becomes the way between two large ones, and its links cannot carry that.

<TryIt title="Announce too much, and see what happens">

Your network buys transit from two providers. Choose what you announce to Transit B, then send traffic from Transit B’s customers to a network behind Transit A.

<RouteLeak />

</TryIt>

Your own routers never sent the leaked traffic anywhere. The routes you announced did it, because Transit B believed them and preferred them. Most transits give their customers' routes a higher local preference, so a leak from a customer wins over the real path.

Three things guard against it, and the template uses all of them:

- **The export ends in a reject.** The template's checks include `Checks.exportsEndInReject`, so `circuit validate` fails on an export that does not, as you saw in the terminal, and `diff` and `apply` stop until it is fixed.
- **`role`** says what each neighbor is to you: `provider`, `customer`, `peer`, or an exchange's route server, `rs`. It turns on RFC 9234, so both sides reject a leaked route on their own. Of the platforms Circuit supports, only RouterOS has BGP roles.
- **`max_prefixes`** is a fuse. When a neighbor sends more prefixes than this, the session closes. It stays closed until it is cleared by hand, on RouterOS with `/routing bgp session clear <session> flag=limit-exceeded`. Set it a little above what each neighbor should send. Your providers set one on their side for you, which is what the limit in the widget showed.

<Quiz
  question="You announce every route you learn from Transit A to Transit B. What happens?"
  :choices="['Nothing, Transit B already knows those routes', 'Transit B may send its customers’ traffic for those networks through you, and your links fill up', 'Transit A stops sending you routes']"
  :answer="1"
  :why="['Transit B knows them from elsewhere too, but it prefers routes from its customers, and you are one.', '', 'Transit A is not told what you announce to Transit B, and keeps sending routes as before.']"
  explain="A transit prefers its customers' routes, so it starts sending traffic for those networks through you. Your links were never meant to carry it, and they fill up. That is a route leak."
/>

## Communities: tags on routes

A <Term means="A tag on a route. A router can add it on import and match on it later, or a neighbor can add it to ask you for something.">BGP community</Term> is a tag a route carries. The template uses large communities, three numbers: your AS, a function, and a parameter, such as `64500:1:1`.

The template's `routing.ts` describes what its communities mean with `Bgp.communityScheme` (see [BGP communities](/guide/communities)), and `communities.tag("transit", 64510)` in the import above does two things to each route:

1. It removes every community of yours the neighbor put on the route, so nobody outside can fake them.
2. It adds where the route came from: `64500:1:1`, learned from a transit, and `64500:3:64510`, learned from AS64510.

A later rule can then match `large_community`. For example, an export to a customer who only buys the routes you learn at exchanges accepts those tagged as learned from an exchange, as in [Selling IX-only transit](/use-cases/ix-transit).

<Quiz
  question="Why does communities.tag remove your own communities that a neighbor put on a route?"
  :choices="['To save memory on the router', 'So a neighbor cannot fake where a route came from, or tell your routers what to do', 'Because a route can carry only one community']"
  :answer="1"
  :why="['Removing a few tags saves almost nothing. The reason is trust.', '', 'A route can carry many communities. The template adds two to each route.']"
  explain="Your policies act on your own tags. If a neighbor could set them, it could make a transit route look like it came from an exchange, or ask for things you only allow trusted neighbors to ask."
/>

## In short

- A route policy is rules read from the top: `call`, then `match`, `set` and `action`. The first decision wins, and a route no rule accepts is rejected.
- On import, reject martians and private ranges, prefixes too long or too short, your own space coming back, and RPKI invalid routes. `Bgp.sanity()` and two prefix sets cover them.
- On export, accept only your own prefixes and your customers', then reject everything else. Anything more can leak routes between two other networks.
- `role` and `max_prefixes` on each neighbor, and the `Checks.exportsEndInReject` check, guard against leaks.
- Communities tag routes with where they came from, so later rules can treat them differently.
