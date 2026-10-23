---
title: BGP
description: BGP is how networks tell each other which prefixes they reach. Bring a session up, announce a prefix, and watch its AS path grow from AS to AS.
---

# BGP

BGP is how autonomous systems tell each other which prefixes they can reach. Two neighboring routers keep a session open over TCP port 179, and through it each announces its routes. Every announcement carries the prefix and its **AS path**: the list of ASes it has passed through.

Before an AS passes a route on to another AS, it puts its own number at the front of the path. An AS that finds its own number already in a path drops the route, so an announcement never goes round in a circle.

## Sessions between neighbors

OSPF routers find their neighbors by saying hello. BGP routers do not: you write down each neighbor, with its address and its AS number, and the neighbor writes down yours. A session comes up only when both sides agree. It goes through these steps:

1. **Connect.** One router opens a TCP connection to the other's address, on port 179.
2. **Open.** Each sends an OPEN message with its AS number, its router ID and how long it will wait for news, the hold time. If an AS number is not the one the other side expects, that side sends a NOTIFICATION with the reason and closes the connection.
3. **Established.** Each answers with a KEEPALIVE, and the session is up.
4. **Updates.** Each sends UPDATE messages with its routes. After that, only changes are sent: a new route, or the withdrawal of one that is gone. Keepalives keep coming, and if nothing arrives for a whole hold time, the session is declared down and every route learned through it is removed.

A router shows each session's state by the name in the BGP standard: Idle, Connect, Active, OpenSent, OpenConfirm or Established. A session stuck in Active is trying to connect and getting no answer.

<TryIt title="Bring up a session with your transit provider">

You are AS64500, and your transit provider is AS64501 at 203.0.113.1. Write the neighbor, then bring the session up. Start with `remote_as` empty, then try a wrong number, then the right one. Once it is up, see what changes with and without the policies, and with a `max_prefixes` of 10.

<BgpSession />

</TryIt>

Notice what happened before you added the policies: the session was up, yet no route came in and none went out. In Circuit, a neighbor with no `import` policy accepts nothing, and one with no `export` policy announces nothing. A session you forgot to filter then carries nothing at all, instead of everything. What goes into those policies is the subject of [Route policies](/academy/intermediate/route-policy).

<Quiz
  question="Your session with a neighbor stays in Active and never gets further. What is most likely wrong?"
  :choices="['remote_as is not the neighbor AS number', 'Your router gets no answer on TCP port 179 at the address you wrote', 'There is no import policy']"
  :answer="1"
  :why="['A wrong AS number is found in the OPEN message, which comes after the TCP connection. The session would get further, to OpenSent, before it closes.', '', 'Policies only matter once the session is Established and routes arrive.']"
  explain="Active means the router keeps trying to open the TCP connection and nobody answers. Check the address, the cable, and that the firewalls on both sides let TCP port 179 in."
/>

## Announcements and the AS path

An announcement is a prefix with some facts about it, called attributes. Two of them matter most here:

- The **AS path**, the ASes the announcement passed through, the nearest first. The last number is the AS where the prefix comes from, its <Term means="The AS that first announces a prefix: the network the addresses belong to. It is the last number of the AS path.">origin</Term>.
- The **next hop**, the address to send traffic to for this prefix. Between two ASes, it is usually the address of the router that sent the announcement.

Read the AS path from right to left and you see how the announcement travelled. Read it from left to right and you see the way the traffic goes.

<TryIt title="Announce your prefix to the internet">

Announce 198.51.100.0/24 from AS64500 and step through the rounds. Watch each path grow by one number at each hop, and watch for the ASes that hear their own number. Then cut a link and announce again.

<BgpAnnounce />

</TryIt>

In this widget, each AS keeps the shortest path it hears and passes it on to every neighbor, the one it heard it from included. Real routers choose between paths with more than their length, and the [next lesson](/academy/intermediate/best-path) shows how. Whether a router sends a route back to the neighbor it came from also differs, but when it does, the check you just watched stops it.

The AS path does three jobs at once:

1. **It stops loops.** An AS that sees its own number in a path drops the route, as AS64500 did in round 2.
2. **It is a rough measure of distance.** Fewer ASes on the way is one of the things BGP prefers.
3. **It says who is on the way.** A policy can refuse a route because of an AS in its path, or because the origin is not the one that should announce that prefix.

<Quiz
  question="Your router in AS64500 receives 198.51.100.0/24 with the AS path 64502 64501 64500. What does it do with it?"
  :choices="['Keeps it, since it is a route to its own block', 'Drops it, since its own number is in the path', 'Passes it on to its other neighbors']"
  :answer="1"
  :why="['Your own block is already yours. A route to it from outside would send your own traffic out and back in.', '', 'It never gets that far. A route with your own AS number in its path is dropped as it arrives.']"
  explain="64500 is in the path, so the announcement has already passed through your AS once. Taking it would make a loop, so BGP drops it."
/>

<Quiz
  question="AS64503 hears 203.0.113.0/24 from AS64502 with the AS path 64502 64510. AS64503 passes it on to AS64504. What AS path does AS64504 see?"
  :choices="['64502 64510', '64503 64502 64510', '64502 64510 64503']"
  :answer="1"
  :why="['AS64503 adds its own number before it passes the route to another AS.', '', 'The new number goes at the front, not the end. The end stays the origin, AS64510.']"
  explain="Each AS puts its own number at the front as it passes a route on, so the nearest AS is first and the origin, AS64510, stays last."
/>

## eBGP and iBGP

A session between two different ASes is **eBGP**, external BGP, and it is what this lesson has been about. A session between two routers of the same AS is **iBGP**, internal BGP. A network with several edge routers uses iBGP so that each knows what the others learned from outside.

iBGP works a little differently: a router does not add its own AS number to the path, since the route has not left the AS, and it does not pass a route learned over iBGP to another iBGP neighbor. So every BGP router in an AS needs a session with every other one, or a router that reflects routes between them. In Circuit, a neighbor whose `remote_as` is your own `asn` is an iBGP session.

## BGP in Circuit

BGP is `routing.bgp`: your AS number, the prefixes you announce, and your neighbors, each under a name of your choice:

```ts
routing: {
    router_id: "203.0.113.2",
    static: [{ prefix: "198.51.100.0/24", blackhole: true, description: "Originate" }],
    bgp: {
        asn: 64500,
        networks: ["198.51.100.0/24"],
        neighbors: {
            transit: {
                address: "203.0.113.1",
                remote_as: 64501,
                role: "provider",
                import: "TRANSIT-IN",
                export: "TRANSIT-OUT",
                max_prefixes: 1_200_000,
            },
        },
    },
},

policies: {
    SANITY: Bgp.sanity(),
    "TRANSIT-IN": [{ call: "SANITY" }, { action: "accept" }],
    "TRANSIT-OUT": [
        { description: "Our block", match: { prefix: "198.51.100.0/24" }, action: "accept" },
        { description: "Nothing else leaves", action: "reject" },
    ],
},
```

| Field          | What it does                                                                                                                                                                                                                                          |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `asn`          | Your AS number.                                                                                                                                                                                                                                       |
| `networks`     | The prefixes this router originates. Each needs a route in the table, which is what the blackhole route from [Routing tables](/academy/intermediate/routing-tables) is for.                                                                           |
| `address`      | The neighbor's address.                                                                                                                                                                                                                               |
| `remote_as`    | The neighbor's AS number. It must match the one in the neighbor's OPEN.                                                                                                                                                                               |
| `role`         | What the neighbor is to you: `provider`, `customer`, `peer`, `rs` for a route server, or `rs-client`. With roles on both sides, each refuses a route the other should not have passed on, such as a provider's routes coming back through a customer. |
| `import`       | The policy for routes you learn from the neighbor. Nothing is accepted without one.                                                                                                                                                                   |
| `export`       | The policy for routes you announce to the neighbor. Nothing is announced without one.                                                                                                                                                                 |
| `max_prefixes` | Close the session if the neighbor sends more routes than this, as a fuse against a mistake on their side.                                                                                                                                             |

`Bgp.sanity()` comes from `@takodotid/circuit/presets` and refuses routes that should never be on the internet; [Route policies](/academy/intermediate/route-policy) opens it up. The input firewall must also let BGP in from your neighbors, so their side can open the session too:

```ts
{ description: "BGP", match: { protocol: "tcp", dst_port: 179, src: "203.0.113.1/32" }, action: "accept" },
```

::: warning Not every platform runs BGP
Of the platforms Circuit supports, `routeros`, `junos` and `fortios` run BGP; `vrp` and `raisecom-ros` report `routing.bgp` as an error. On RouterOS one session carries one address family, so an IPv4 and an IPv6 neighbor are two sessions, as in the [edge router](/patterns/edge-router) pattern. Junos and FortiOS have no BGP roles, so they report `role` as an error. FortiOS has no RPKI either, so it refuses the RPKI rule in `Bgp.sanity()`. See [Platforms](/platforms/).
:::

## In short

- BGP neighbors are written by hand on both sides, and keep a session over TCP port 179: connect, OPEN, KEEPALIVE, then UPDATEs.
- An announcement carries a prefix and its AS path; each AS puts its own number at the front before passing it on.
- An AS that finds its own number in a path drops the route, so announcements cannot loop.
- eBGP runs between ASes; iBGP runs inside one, without adding to the path.
- In Circuit, BGP is `routing.bgp` with `asn`, `networks` and `neighbors`; a neighbor with no `import` or `export` policy accepts or announces nothing.
