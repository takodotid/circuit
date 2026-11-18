---
title: Choosing the best route
description: BGP compares several routes to one prefix step by step. Change their attributes, predict the winner, and steer traffic out and in.
---

# Choosing the best route

A router that runs BGP often hears about the same prefix from several neighbors: two transits, a peer at an exchange, and your other router. It puts only one of those routes in its routing table, and all traffic to that prefix goes that way. To choose, it compares the routes by a fixed list of attributes, one at a time. The first attribute on which they differ decides.

You change the choice with policy. Local preference decides how traffic leaves your network. AS path prepending gives other networks a hint about how traffic should come in.

## The order of comparison

Every route that BGP carries has a few attributes besides its prefix. These are the ones that decide here:

- **Local preference**: a number your own routers give a route as it comes in. You set it, and it stays inside your AS.
- **AS path**: the list of ASes the announcement passed through, as in [BGP](/academy/intermediate/bgp).
- **<Term means="A BGP attribute that says how a route first entered BGP. IGP means the network announced it itself, and incomplete means it was copied in from another source, such as static routes. EGP, from the protocol before BGP, is almost never seen.">Origin</Term>**: how the route first entered BGP, written as IGP, EGP, or incomplete.
- **MED**: the <Term means="Multi-exit discriminator: a number a neighboring AS puts on the routes it sends you, to say which of the links between you it wants you to use. Lower wins.">multi-exit discriminator</Term>.

Only the routes that your import policy accepted take part. Of these, the router keeps the routes that are best on the first attribute. Then it compares only those by the next attribute, and so on, until one route is left:

1. Highest local preference.
2. Shortest AS path.
3. The best origin, where IGP comes first, then EGP, then incomplete.
4. Lowest MED.
5. A route learned over eBGP, from another AS, before one learned over iBGP, from your own router.
6. A tie-break: the lowest <Term means="A number, written like an IPv4 address, that a router is known by to its BGP and OSPF neighbors.">router ID</Term> of the neighbor that sent the route.

::: warning This order is simplified
Real routers follow a longer list, and platforms differ in the details. Some check a weight of their own before local preference. Most compare MED only between routes from the same neighboring AS, but this lesson compares it between all routes. Between steps 5 and 6, many routers prefer the route whose next hop is closest inside your network. Some prefer the route they have held longest. Read your platform's documentation before you rely on anything below the AS path.
:::

<TryIt title="Pick the best of four routes">

<BestPath />

</TryIt>

At the start, Cloudflare's route from the exchange wins at step 2. Its path is one AS long, because Cloudflare owns the prefix. Every route had the same local preference, so step 1 changed nothing, and the AS path decided.

Now look at what it took to make Cogent win: one change of local preference, from 100 to anything higher. Its longer path didn't matter, because step 2 is never reached once step 1 has a winner. That is the idea of the order: an earlier step always beats a later one, however large the difference there.

<Quiz
  question="Route 1 has local preference 100 and an AS path of 2 ASes. Route 2 has local preference 150 and an AS path of 4 ASes. Which one does the router use?"
  :choices="['Route 1, because its path is shorter', 'Route 2, because its local preference is higher', 'Both, sharing the traffic']"
  :answer="1"
  :why="['The AS path is only compared when local preference is equal. Here it is not, so step 1 already decides.', '', 'BGP installs one best route for a prefix. Sharing traffic over several needs extra settings this lesson does not cover.']"
  explain="Local preference is compared first. Route 2 has the higher one, so it wins before the AS path is ever looked at."
/>

## Local preference decides how traffic leaves

When a device in your network sends traffic to the internet, your routers choose the way out. Local preference is how you make that choice on purpose, instead of leaving it to the length of the AS path.

You set it on import, per neighbor, with a `set` in a policy rule. The [edge router example](/guide/examples#an-edge-router) does it for its transit and its exchange. Here are its two import policies, in `routing.policies`:

<<< @/../examples/edge-router/sites/pop-1/edge-01.ts#local-pref

Every route from the exchange gets 200, and the same route from the transit gets 100. So traffic to a network that is at both takes the exchange. You usually pay a transit for every bit it carries, while an exchange port usually costs a fixed fee. The networks there are often closer, too.

A common pattern gives routes from customers the highest value, then peers, then transit. The numbers are your choice: only their order matters. The other rules decide which routes are accepted at all, and [Route policies](/academy/intermediate/route-policy) explains them.

Local preference travels between your own routers over iBGP. That is why the route from edge-02 in the widget had one. It is never sent to another AS.

<Quiz
  question="You give routes from the exchange local preference 200. Which routers use that number?"
  :choices="['Only the routers inside your own AS', 'Every router on the internet that receives your routes', 'The routers of the exchange peer']"
  :answer="0"
  :why="['', 'Local preference is not sent over eBGP. Other networks never see the number you chose.', 'The peer never sees it either. It decides about the routes you hold, not the ones you send.']"
  explain="Local preference stays inside your AS. Your routers share it over iBGP so they all pick the same way out, and no other network ever sees it."
/>

## Prepending gives a hint for traffic coming in

Traffic coming to you is a different matter. Each network on the way chooses its own best route to your prefix, with its own local preference, and you can't set that for them.

What you can change is what you announce. <Term means="Adding your own AS number to the AS path several more times before you announce a route, so the path looks longer and less traffic comes in that way.">AS path prepending</Term> makes the path through one neighbor look longer. A network that reaches you both ways, and decides by the length of the path, then prefers the other way in.

<TryIt title="Steer the traffic coming in">

<PrependPath />

</TryIt>

Prepending once was enough to move the traffic, because Arelion compared the AS path. Once Arelion set a local preference of its own, nothing you prepended made a difference. It decided at step 1, before it looked at the path.

That is the limit of prepending. It is a hint, and it works only on networks that reach the AS path step. Many transit providers prefer routes from their own customers by local preference. So prepending toward a transit often moves less traffic than you hoped. Some providers let you ask them for a lower preference with a community, a tag you meet in the next lesson.

In Circuit, prepending is `set: { prepend: 2 }` on the export rule that announces your prefix, as in the widget's file. The number is how many more times your AS is added, so the far network sees your AS three times in all. The same `set` can also have `med`: a number you give a neighbor that you reach over several links, to say which link it should send through.

<Quiz
  question="You prepend three times toward Hurricane Electric, but a far network still sends all its traffic to you through Hurricane Electric. How can that be?"
  :choices="['Prepending only works on the first router after you', 'The far network prefers Hurricane Electric by its own local preference, which is checked before the AS path', 'Three times is not enough, it must be more than five']"
  :answer="1"
  :why="['The longer path is seen by every network that receives the announcement, not only the first.', '', 'If the far network decides by local preference, no number of prepends changes its mind.']"
  explain="Each network chooses with its own policy. A local preference on its side decides at step 1, so the path length you made longer is never compared."
/>

## In short

- BGP compares the routes to one prefix one attribute at a time, and the first difference decides.
- In this lesson's simplified order: highest local preference, shortest AS path, lowest origin, lowest MED, eBGP over iBGP, and then a tie-break. Platforms differ in the details.
- Local preference, set on import with `{ set: { local_pref: 200 } }`, decides how traffic leaves your network. It never leaves your AS.
- Prepending with `{ set: { prepend: 2 } }` makes a path look longer to others. It is a hint for traffic coming in, and a network's own local preference overrides it.
