---
title: Choosing the best route
description: BGP compares several routes to one prefix step by step. Change their attributes, predict the winner, and steer traffic out and in.
---

# Choosing the best route

A router running BGP often hears about the same prefix from several neighbors: from two transits, from a peer at an exchange, and from your other router. It puts only one of those routes in its routing table, and all traffic to that prefix goes that way. To choose, it compares the routes on a fixed list of attributes, one at a time, and the first attribute on which they differ decides.

You change the choice with policy. Local preference decides how traffic leaves your network, and AS path prepending gives other networks a hint about how traffic should come in.

## The order of comparison

Every route BGP carries has a few attributes besides its prefix. These are the ones that decide here:

- **Local preference**: a number your own routers give a route as it comes in. Higher is better. You set it, and it stays inside your AS.
- **AS path**: the list of ASes the announcement passed through, which you followed in [BGP](/academy/intermediate/bgp). Shorter is better.
- **Origin**: how the route first entered BGP. <Term means="The network that owns the prefix announced it into BGP itself. The usual case.">IGP</Term>, <Term means="It came from EGP, the protocol BGP replaced. You will almost never see it.">EGP</Term>, or <Term means="It was copied into BGP from another source, such as static routes, so BGP cannot say where it began.">incomplete</Term>. IGP is best, then EGP, then incomplete.
- **MED**, the <Term means="A number a neighboring AS puts on the routes it sends you, to say which of its several links into it you should use. Lower is better.">multi-exit discriminator</Term>. Lower is better.

Only routes your import policy accepted take part. A route it rejected never reaches the comparison. Of the rest, the router keeps those that are best on the first attribute, then compares only those on the next, and so on, until one route is left:

1. Highest local preference.
2. Shortest AS path.
3. Lowest origin: IGP, then EGP, then incomplete.
4. Lowest MED.
5. A route learned over eBGP, from another AS, before one learned over iBGP, from your own router.
6. A tie-break: the lowest <Term means="A number written like an IPv4 address that names a router to its BGP neighbors, set with router_id in Circuit.">router ID</Term> of the neighbor that sent the route.

::: warning This order is simplified
Real routers follow a longer list, and platforms differ in the details. Some check a weight of their own before local preference. Most compare MED only between routes from the same neighboring AS, where this lesson compares it between all routes. Between steps 5 and 6, many prefer the route whose next hop is closest inside your network, and some prefer the route they have held longest. Read your platform's documentation before you rely on anything below the AS path.
:::

The widget applies exactly the six steps above, in that order.

<TryIt title="Pick the best of four routes">

Four routes reach one prefix. Change their local preference, origin and MED, and watch which step decides. Then work through the three tasks under the steps.

<BestPath />

</TryIt>

At the start, the exchange peer wins at step 2. Its path is one AS long, because the network you want to reach is the peer itself. Every route had the same local preference, so step 1 changed nothing and the AS path decided.

Now look at what it took to make Transit B win: one change of local preference, from 100 to anything higher. Its longer path did not matter, because step 2 is never reached once step 1 has a winner. That is the whole idea of the order: an earlier step always beats a later one, however large the difference there.

<Quiz
  question="Route 1 has local preference 100 and an AS path of 2 ASes. Route 2 has local preference 150 and an AS path of 4 ASes. Which one does the router use?"
  :choices="['Route 1, because its path is shorter', 'Route 2, because its local preference is higher', 'Both, sharing the traffic']"
  :answer="1"
  :why="['The AS path is only compared when local preference is equal. Here it is not, so step 1 already decides.', '', 'BGP installs one best route for a prefix. Sharing traffic over several needs extra settings this lesson does not cover.']"
  explain="Local preference is compared first. Route 2 has the higher one, so it wins before the AS path is ever looked at."
/>

## Local preference decides how traffic leaves

When a device in your network sends traffic to the internet, your routers choose the way out. Local preference is how you make that choice on purpose instead of leaving it to the length of the AS path.

You set it on import, per neighbor, with a policy rule that has only a `set`. The [edge router template](/patterns/edge-router) does it for its transit and its exchange. Here are its two import policies, with the neighbors' AS numbers taken from the documentation range:

```ts
policies: {
    SANITY: bgpSanity(),
    // A route from the exchange is preferred over the same route from the transit: higher local preference wins.
    "TRANSIT-IN": [{ call: "SANITY" }, communities.tag("transit", 64510), { set: { local_pref: 100 } }, { action: "accept" }],
    "IX-IN": [{ call: "SANITY" }, communities.tag("exchange", 64511), { set: { local_pref: 200 } }, { action: "accept" }],
},
```

Every route from the exchange gets 200, and the same route from the transit gets 100, so traffic to a network present at both takes the exchange. You usually pay a transit for every bit it carries, while an exchange port usually costs a fixed fee, and the networks there are often closer. A common pattern is to give routes from customers the highest value, then peers, then transit, but the numbers themselves are your choice: only the order between them matters.

`{ call: "SANITY" }` and `communities.tag` decide which routes are accepted at all. They are the subject of [Route policies](/academy/intermediate/route-policy).

Local preference travels between your own routers over iBGP, which is why the route from edge-02 in the widget had one. It is never sent to another AS.

<Quiz
  question="You give routes from the exchange local preference 200. Which routers use that number?"
  :choices="['Only the routers inside your own AS', 'Every router on the internet that receives your routes', 'The routers of the exchange peer']"
  :answer="0"
  :why="['', 'Local preference is not sent over eBGP. Other networks never see the number you chose.', 'The peer never sees it either. It decides about the routes you hold, not the ones you send.']"
  explain="Local preference stays inside your AS. Your routers share it over iBGP so they all pick the same way out, and no other network ever sees it."
/>

## Prepending gives a hint for traffic coming in

Traffic coming to you is a different matter. Each network on the way chooses its own best route to your prefix, with its own local preference, and you cannot set that for them.

What you can change is what you announce. <Term means="Adding your own AS number to the path several more times before you announce a route, so the path looks longer than it is.">AS path prepending</Term> makes the path through one neighbor look longer. A network that reaches you both ways, and decides on the length of the path, then prefers the other way in.

<TryIt title="Steer the traffic coming in">

A far network reaches you through two transits. Send traffic to see which one it uses, then prepend toward that transit and send again. Last, give the far network a preference of its own.

<PrependPath />

</TryIt>

Prepending once was enough to move the traffic, because the far network compared the AS path. Once it set a local preference of its own, nothing you prepended made a difference: it decided at step 1, before looking at the path.

That is the limit of prepending. It is a hint, and it only works on networks that reach the AS path step. Many transit providers prefer routes from their own customers by local preference, so prepending toward a transit often moves less traffic than you hoped. Some providers let you ask them for a lower preference with a community, a tag you meet in the next lesson.

In Circuit, prepending is `set: { prepend: 2 }` on the export rule that announces your prefix, as in the widget's file. The number is how many more times your AS is added, so the far network sees your AS three times in all. The same `set` can carry `med`, the number you offer a neighbor you reach over several links, to say which of them it should send through.

<Quiz
  question="You prepend three times toward Transit A, but a far network still sends all its traffic to you through Transit A. How can that be?"
  :choices="['Prepending only works on the first router after you', 'The far network prefers Transit A by its own local preference, which is checked before the AS path', 'Three times is not enough, it must be more than five']"
  :answer="1"
  :why="['The longer path is seen by every network that receives the announcement, not only the first.', '', 'If the far network decides by local preference, no number of prepends changes its mind.']"
  explain="Each network chooses with its own policy. A local preference on its side decides at step 1, so the path length you made longer is never compared."
/>

## In short

- BGP compares the routes to one prefix one attribute at a time, and the first difference decides.
- In this lesson's simplified order: highest local preference, shortest AS path, lowest origin, lowest MED, eBGP over iBGP, then a tie-break. Platforms differ in the details.
- Local preference, set on import with `{ set: { local_pref: 200 } }`, decides how traffic leaves your network. It never leaves your AS.
- Prepending with `{ set: { prepend: 2 } }` makes a path look longer to others. It is a hint for traffic coming in, and a network's own local preference overrides it.
