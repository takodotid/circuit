---
title: Route policies
description: Filter the routes you accept and announce with BGP route policies. Feed routes through an import, and see what a careless export does.
---

# Route policies

A route policy is a list of rules that every route passes through, from the top. On import, it decides which routes you accept from a neighbor, and how you mark them. On export, it decides which routes you announce to that neighbor.

The rule for both is short: never accept everything, and never announce everything.

## How a policy is read

In a device file, `routing.policies` holds named lists of rules. Each BGP neighbor says, by name, which list is its `import_policy` and which is its `export_policy`. The rules are read from the top, and a rule is one of three kinds.

A **call** runs another policy at that point, for every route: `{ call: "sanity" }`. A route that the called policy accepts or rejects stops there, and any other route goes on to the next rule. A call holds nothing else. To call a policy for some routes only, put the condition inside that policy.

A **communities rule**, such as `{ communities: "import" }`, stands for the rules that your community scheme needs at that point. [Communities](#communities-tags-on-routes) explains it.

Every other rule has up to three parts, used in this order:

1. `if`: which routes the rule applies to, such as a `prefix`, a `prefix_set`, a `prefix_length`, an `rpki` state, or a `large_community`. A rule without `if` applies to every route.
2. `set`: what to change on the route, such as `local_pref` from [Choosing the best route](/academy/intermediate/best-path).
3. `then`: `accept` or `reject`, which ends the policy for that route.

A rule without `then` changes the route and moves on to the next rule. The first decision wins, and a route that no rule accepts is rejected.

## What to keep out

A neighbor can send you routes it shouldn't. It may do so by mistake or on purpose. Four kinds should never reach your routing table:

1. **Addresses that are not on the internet**: private ranges such as `10.0.0.0/8`, and <Term means="Addresses that can never be a real destination on the internet. For example, 127.0.0.0/8 means the device itself, and 169.254.0.0/16 is used only on one link.">martians</Term>. Circuit's ready-made values list them as `presets.rfc1918` and `presets.bogons`.
2. **Prefixes too long or too short.** Most networks accept nothing longer than a /24 for IPv4, or a /48 for IPv6. So a longer prefix wouldn't travel far, and it only makes every table bigger. Nothing shorter than a /8 or a /16 is a real network either.
3. **Your own prefixes, coming back.** You already know where your own space is. A neighbor that announces it means that someone else claims it. It may be a mistake or an attempt to steal its traffic.
4. **Routes that RPKI marks invalid.** With <Term means="Resource Public Key Infrastructure: the holder of a prefix publishes a signed record, a ROA, that says which AS may announce it. Routers check each route against those records.">RPKI</Term>, a validator compares each route with the published records. A route is `valid` if a record allows it, `invalid` if one contradicts it, and `not-found` if there is none. Your validators go in `routing.rpki`.

`presets.bgp_sanity` holds the rules for the second and the fourth. The first and the third need a `prefix_set` each, a named list of prefixes. A route matches a set when its prefix is one of the set's own, or inside one:

```ts
routing: {
    prefix_sets: {
        // Every IPv4 block RFC 6890 keeps off the internet: the martians and the private ranges.
        bogons: { prefixes: presets.bogons.ipv4 },
        ours: { prefixes: ["198.51.100.0/24"] },
    },
    policies: {
        sanity: presets.bgp_sanity,
        "transit-import": [
            { call: "sanity" },
            { description: "Martians and private ranges", if: { prefix_set: "bogons" }, then: "reject" },
            { description: "Our own space, coming back", if: { prefix_set: "ours" }, then: "reject" },
            { communities: "import" },
            { set: { local_pref: 100 }, then: "accept" },
        ],
    },
},
```

`presets.bogons.ipv4` also holds the documentation ranges, such as `203.0.113.0/24`. The widget uses them for real networks, so its `bogons` set leaves them out.

<TryIt title="Run routes through an import policy">

<PolicyFilter />

</TryIt>

Look at `203.0.113.128/25`. RPKI marks it invalid, but the length check rejected it, because that check comes first inside `sanity`. The first decision wins, so a later rule never sees the route.

With `sanity` off, the default route, the /25, the /64, and `192.0.2.0/24` all get in. With the last rule off, nothing gets in at all, not even the good routes, because a route that no rule accepts is rejected. That is why every import ends in a rule with `then: "accept"`, after every rule that rejects.

<Quiz
  question="A transit sends you 192.168.40.0/22, and RPKI says not-found. Which rule of transit-import rejects it?"
  :choices="['The sanity policy, because it is too long', 'Martians and private ranges', 'Our own space, coming back', 'None: it is accepted']"
  :answer="1"
  :why="['A /22 is between /8 and /24, so the length rules let it through, and not-found is not invalid.', '', 'Your own space is 198.51.100.0/24. This is private space.', 'It is inside 192.168.0.0/16, one of the private ranges in the bogons set.']"
  explain="A /22 passes the length checks, and not-found is not invalid, so the sanity policy lets it through. It is inside 192.168.0.0/16, which is in the bogons set, so the next rule rejects it."
/>

## What to announce

An export accepts your own prefixes, and your customers' if you sell them transit. Then it rejects everything else. The [edge router example](/guide/examples#an-edge-router) writes it like this, where the prefix set `ours` holds your own blocks:

```ts
export: [
    { communities: "export" },
    { description: "Our own space", if: { prefix_set: "ours" }, then: "accept" },
    { description: "Nothing else leaves", then: "reject" },
],
```

If you announce more than that, you cause a <Term means="Routes learned from one provider or peer, announced to another, so traffic between two other networks starts to flow through yours.">route leak</Term>. A small network suddenly becomes the way between two large ones, and its links can't carry that.

<TryIt title="Announce too much, and see what happens">

You buy transit from Hurricane Electric and from AS64510, a transit that doesn't filter what its customers announce.

<RouteLeak />

</TryIt>

You never sent that traffic anywhere yourself. The routes you announced pulled it in, because AS64510 believed them and preferred them. Most transits give their customers' routes a higher local preference, so a leak from a customer wins over the real path.

Three things guard against a leak, and the example uses all of them:

- **The export ends in a reject.** The example turns on `exports_end_in_reject: true` in `checks`. So `circuit validate` fails on an export that doesn't end in a reject, as the widget's terminal showed. `diff` and `apply` stop too, until you fix it.
- **`role`** says what each neighbor is to you: `provider`, `customer`, `peer`, or an exchange's route server, `rs`. It turns on RFC 9234, so both sides reject a leaked route by themselves. Of the platforms Circuit supports, only RouterOS has BGP roles.
- **`max_prefixes`** is a fuse. When a neighbor sends more prefixes than this, the session closes, and it stays closed until you clear it. On RouterOS, [`circuit bgp`](/reference/cli#bgp) with `--clear-limit` opens it again. Set the limit a little higher than what each neighbor should send. Your providers set one for you on their side, as the limit in the widget showed.

<Quiz
  question="You announce every route you learn from Hurricane Electric to AS64510. What happens?"
  :choices="['Nothing, AS64510 already knows those routes', 'AS64510 may send its customers’ traffic for those networks through you, and your links fill up', 'Hurricane Electric stops sending you routes']"
  :answer="1"
  :why="['AS64510 knows them from elsewhere too, but it prefers routes from its customers, and you are one.', '', 'Hurricane Electric is not told what you announce to AS64510, and keeps sending routes as before.']"
  explain="A transit prefers its customers' routes, so it starts sending traffic for those networks through you. Your links were never meant to carry it, and they fill up. That is a route leak."
/>

## Communities: tags on routes

A <Term means="A tag on a route. Your router can add it when a route comes in and match on it later, or a neighbor can add it to ask you to do something with the route.">BGP community</Term> is a tag that a route carries. The example uses large communities. Each one is three numbers: your AS, a function, and a parameter, such as `64500:1:1`.

The example's `circuit.ts` says what its communities mean, in `communities`, as [BGP communities](/guide/communities) explains. Then `{ communities: "import" }` in the import does two things to each route:

1. It removes every community of yours that the neighbor put on the route, so nobody outside can fake them.
2. It adds where the route came from. That is `64500:1:1` for the transit group, and `64500:3:6939` for Hurricane Electric, AS6939.

A later rule can then match a `large_community`. For example, a customer may buy only the routes you learn at exchanges. Its export accepts the routes tagged as learned from an exchange. [What an ISP sells](/academy/professional/internet-products) shows that product.

<Quiz
  question="Why does the communities rule of an import remove your own communities that a neighbor put on a route?"
  :choices="['To save memory on the router', 'So a neighbor cannot fake where a route came from, or tell your routers what to do', 'Because a route can carry only one community']"
  :answer="1"
  :why="['Removing a few tags saves almost nothing. The reason is trust.', '', 'A route can carry many communities. The example adds two to each route.']"
  explain="Your policies act on your own tags. If a neighbor could set them, it could make a transit route look like it came from an exchange, or ask for things you only allow trusted neighbors to ask."
/>

## In short

- A route policy is rules read from the top: a `call` to another policy, a communities rule, or a rule with `if`, `set`, and `then`. The first decision wins, and a route that no rule accepts is rejected.
- On import, reject martians and private ranges, prefixes too long or too short, your own space coming back, and RPKI invalid routes. `presets.bgp_sanity` and two prefix sets cover them.
- On export, accept only your own prefixes and your customers', and then reject everything else. Anything more can leak routes between two other networks.
- `role` and `max_prefixes` on each neighbor, and the `exports_end_in_reject` check, guard against leaks.
- Communities tag routes with where they came from, so later rules can treat them differently.
