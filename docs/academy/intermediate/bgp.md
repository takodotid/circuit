---
title: BGP
description: BGP is how networks tell each other which prefixes they reach. Bring a session up, announce a prefix, and watch its AS path grow from AS to AS.
---

# BGP

BGP is how autonomous systems tell each other which prefixes they can reach. Two neighboring routers keep a session open over TCP port 179, and each one announces its routes through it. Every announcement carries the prefix and its **AS path**: the list of ASes it has passed through.

Before an AS passes a route on to another AS, it puts its own number at the front of the path. An AS that finds its own number already in a path drops the route. So an announcement never goes round in a circle.

## Sessions between neighbors

OSPF routers find their neighbors by saying hello, but BGP routers don't. You write down each neighbor, with its address and its AS number, and the neighbor writes down yours. A session comes up only when both sides agree. It goes through these steps:

1. **Connect.** One router opens a TCP connection to the other's address, on port 179.
2. **Open.** Each router sends an OPEN message with its AS number, its router ID, and its hold time: how long it waits for news. If an AS number is not the one the other side expects, that side sends a NOTIFICATION with the reason, and closes the connection.
3. **Established.** Each router answers with a KEEPALIVE, and the session is up.
4. **Updates.** Each router sends UPDATE messages with its routes. After that, only changes are sent: a new route, or the withdrawal of one that is gone. KEEPALIVE messages keep coming. If nothing arrives for a whole hold time, the session goes down, and every route learned through it is removed.

A router shows each session's state by its name in the BGP standard. The states are Idle, Connect, Active, OpenSent, OpenConfirm, and Established. A session stuck in Active is trying to connect and getting no answer.

<TryIt title="Bring up a session with your transit provider">

<BgpSession />

</TryIt>

Before you added the policies, the session was up. Yet no route came in, and none went out. In Circuit, a neighbor without an `import_policy` accepts nothing, and one without an `export_policy` announces nothing. So a session you forgot to filter carries nothing, instead of everything. What goes into those policies is the subject of [Route policies](/academy/intermediate/route-policy).

<Quiz
  question="Your session with a neighbor stays in Active and never gets further. What is most likely wrong?"
  :choices="['remote_as is not the neighbor AS number', 'Your router gets no answer on TCP port 179 at the address you wrote', 'There is no import policy']"
  :answer="1"
  :why="['A wrong AS number is found in the OPEN message, which comes after the TCP connection. The session would get further, to OpenSent, before it closes.', '', 'Policies only matter once the session is Established and routes arrive.']"
  explain="Active means the router keeps trying to open the TCP connection and nobody answers. Check the address, the cable, and that the firewalls on both sides let TCP port 179 in."
/>

## Announcements and the AS path

An announcement is a prefix with facts about it, called attributes. Two of them matter most here:

- The **AS path**: the ASes the announcement passed through, the nearest first. The last number is the AS where the prefix comes from, its <Term means="The AS that first announced a prefix: the network the addresses belong to. It is the last AS in the AS path.">origin</Term>.
- The **next hop**: the address to send traffic to for this prefix. Between two ASes, it is usually the address of the router that sent the announcement.

Read the AS path from right to left, and you see how the announcement traveled. Read it from left to right, and you see the way the traffic goes.

<TryIt title="Announce your prefix to the internet">

<BgpAnnounce />

</TryIt>

In this widget, each AS keeps the shortest path it hears. It passes the path on by the rules from [Networks of networks](/academy/intermediate/autonomous-systems). A route from a customer goes to every neighbor, and a route from a provider or a peer goes only to customers. Real routers choose between paths with more than their length, as [Choosing the best route](/academy/intermediate/best-path) shows. Real routers also differ in whether they send a route back to the neighbor it came from. When they do, the loop check you just watched stops it.

The AS path does three jobs at once:

1. **It stops loops.** An AS that sees its own number in a path drops the route, as you did in round 2.
2. **It is a rough measure of distance.** BGP prefers fewer ASes on the way, among other things.
3. **It says who is on the way.** A policy can refuse a route because of an AS in its path. It can also refuse a route whose origin is not the AS that should announce that prefix.

<Quiz
  question="Your router in AS64500 receives 198.51.100.0/24 with the AS path 174 6939 64500. What does it do with it?"
  :choices="['Keeps it, since it is a route to its own block', 'Drops it, since its own number is in the path', 'Passes it on to its other neighbors']"
  :answer="1"
  :why="['Your own block is already yours. A route to it from outside would send your own traffic out and back in.', '', 'It never gets that far. A route with your own AS number in its path is dropped as it arrives.']"
  explain="64500 is in the path, so the announcement has already passed through your AS once. Taking it would make a loop, so BGP drops it."
/>

<Quiz
  question="Netflix, AS2906, is your customer and announces its prefix to you. You pass it on to Hurricane Electric, AS6939, which passes it on to Cloudflare, AS13335. What AS path does Cloudflare see?"
  :choices="['64500 2906', '6939 64500 2906', '64500 2906 6939']"
  :answer="1"
  :why="['Hurricane Electric adds its own number before it passes the route to another AS.', '', 'The new number goes at the front, not the end. The end stays the origin, AS2906.']"
  explain="Each AS puts its own number at the front as it passes a route on, so the nearest AS is first. The origin, AS2906, stays last."
/>

## eBGP and iBGP

A session between two different ASes is **eBGP**, external BGP, and this lesson has been about it so far. A session between two routers of the same AS is **iBGP**, internal BGP. A network with several edge routers uses iBGP, so that each one knows what the others learned from outside.

iBGP works a little differently. A router doesn't add its own AS number to the path, because the route hasn't left the AS. It also doesn't pass a route learned over iBGP to another iBGP neighbor. So every BGP router in an AS needs a session with every other one, or a router that reflects routes between them. In Circuit, a neighbor whose `remote_as` is your own `asn` is an iBGP session. [BGP inside a network](/academy/professional/ibgp-at-scale) goes further.

## BGP in Circuit

BGP is `routing.bgp`: the prefixes you announce, and your neighbors, each under a name you choose:

```ts
routing: {
    router_id: "203.0.113.2",
    static_routes: [{ prefix: "198.51.100.0/24", blackhole: true, description: "Originate" }],
    bgp: {
        originated_prefixes: ["198.51.100.0/24"],
        neighbors: {
            "hurricane-electric": {
                address: "203.0.113.1",
                remote_as: 6939,
                description: "Hurricane Electric",
                role: "provider",
                import_policy: "transit-import",
                export_policy: "transit-export",
                max_prefixes: 1_200_000,
            },
        },
    },
    policies: {
        sanity: presets.bgp_sanity,
        "transit-import": [{ call: "sanity" }, { then: "accept" }],
        "transit-export": [
            { description: "Our block", if: { prefix: "198.51.100.0/24" }, then: "accept" },
            { description: "Nothing else leaves", then: "reject" },
        ],
    },
},
```

| Field                 | What it does                                                                                                                                                                                                                                              |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `originated_prefixes` | The prefixes this router announces. Each one needs a route in the table, which is what the blackhole route from [Routing tables](/academy/intermediate/routing-tables) is for.                                                                            |
| `address`             | The neighbor's address.                                                                                                                                                                                                                                   |
| `remote_as`           | The neighbor's AS number. It must match the one in the neighbor's OPEN.                                                                                                                                                                                   |
| `role`                | What the neighbor is to you: `provider`, `customer`, `peer`, `rs` for a route server, or `rs-client`. With roles on both sides, each side refuses a route the other should not have passed on, such as a provider's route coming back through a customer. |
| `import_policy`       | The policy for the routes you learn from the neighbor. Nothing is accepted without one.                                                                                                                                                                   |
| `export_policy`       | The policy for the routes you announce to the neighbor. Nothing is announced without one.                                                                                                                                                                 |
| `max_prefixes`        | Close the session if the neighbor sends more routes than this. It is a fuse against a mistake on their side.                                                                                                                                              |

`presets.bgp_sanity` is one of Circuit's ready-made values. It refuses routes that should never be on the internet, and [Route policies](/academy/intermediate/route-policy) opens it up. The input firewall must also let BGP in from your neighbors, so that their side can open the session too:

```ts
{ description: "BGP", if: { protocol: "tcp", dst_port: presets.ports.bgp, src: "203.0.113.1/32" }, then: "accept" },
```

::: warning Not every platform runs BGP
RouterOS, Junos, and FortiOS run BGP. VRP and Raisecom ROS report `routing.bgp` as an error. Only RouterOS has BGP roles, so the others report `role` as an error. FortiOS has no RPKI, so it refuses the RPKI rule in `presets.bgp_sanity`. See [Platforms](/reference/platforms).
:::

## In short

- BGP neighbors are written by hand on both sides. They keep a session over TCP port 179: connect, OPEN, KEEPALIVE, and then UPDATE messages.
- An announcement carries a prefix and its AS path. Each AS puts its own number at the front before it passes the announcement on.
- An AS that finds its own number in a path drops the route, so announcements can't loop.
- eBGP runs between ASes. iBGP runs inside one AS, and adds nothing to the path.
- In Circuit, BGP is `routing.bgp`, with `originated_prefixes` and `neighbors`. A neighbor without an `import_policy` or an `export_policy` accepts or announces nothing.
