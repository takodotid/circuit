---
title: BGP inside a network
description: Run iBGP between loopbacks over OSPF, count the sessions a full mesh needs against route reflectors, and keep it fast and whole with ECMP, BFD and matching MTUs.
---

# BGP inside a network

Every router in your AS that must know the routes from outside runs iBGP with the others. The sessions run between loopback addresses, and OSPF carries the way to those loopbacks, so a session survives the loss of any one link. Because a router never passes on a route it learned over iBGP to another iBGP neighbor, every router needs a session with every other, a **full mesh**, or **route reflectors** that pass routes on for the rest.

Around that core, four things keep it working at scale: a next hop every router can reach, equal paths shared with ECMP, failures noticed in under a second with BFD, and the same MTU at both ends of every link.

## Why iBGP needs a full mesh

Between ASes, the AS path stops loops: a router drops a route that already holds its own AS number. Inside one AS, the path does not grow, since the route never leaves the AS, so it cannot show a loop. BGP's standard settles it with a rule instead: a router that receives a route from an internal neighbor does not pass it on to other internal neighbors.

That rule means a route learned at one edge router reaches only the routers with a session to that edge router. For every router to learn every route, every router needs a session with every other. That is a <Term means="A design in which every router has a session with every other router. With n routers, that is n(n-1)/2 sessions.">full mesh</Term>, and it grows fast: with n routers, it takes n(n-1)/2 sessions.

<TryIt title="Count the sessions a network needs">

Start with a full mesh and add a router, and read which files change. Then switch to two route reflectors and add one again. Try failing a reflector with one, then with two.

<ReflectorCount />

</TryIt>

The count is only half of it. In a full mesh, adding one router changes the file of every router already there, since each needs a session to the new one. At 50 routers, that is one new router and 49 other files in the same change, for 1,225 sessions in all.

<Quiz
  question="An AS has 20 routers that run BGP, in a full mesh. How many iBGP sessions is that?"
  :choices="['20', '190', '380']"
  :answer="1"
  :why="['That would be one session per router. Each router has 19 sessions, one to each of the others.', '', 'That counts every session twice, once from each end. Divide by two: 20 x 19 / 2.']"
  explain="Each of the 20 routers has a session with the 19 others, and each session joins two routers, so 20 x 19 / 2 = 190."
/>

## Route reflectors

A <Term means="A router that passes routes learned over iBGP on to other iBGP neighbors, its clients, so they do not need a full mesh. RR for short.">route reflector</Term> is a router allowed to break the rule: it passes iBGP routes on. Its iBGP neighbors are split into two groups:

1. **Clients** have a session only with their reflectors. A route from a client is reflected to every other client and to every non-client.
2. **Non-clients** are ordinary iBGP neighbors, in a full mesh with each other and the reflectors. A route from a non-client is reflected to the clients only.

A reflector and its clients form a <Term means="A route reflector, or a pair of them, and the clients they serve. Each cluster has an ID that reflected routes carry.">cluster</Term>. With clients that have sessions only with their reflectors, the count drops from n(n-1)/2 to roughly two per router: each client has a session with each of its reflectors, and the reflectors have a full mesh among themselves.

Two attributes stop reflected routes from looping. A reflector writes the <Term means="A BGP attribute a route reflector adds: the router ID of the router inside the AS that first announced the route. That router drops the route if it comes back.">ORIGINATOR_ID</Term>, and the router named there drops the route if it ever comes back to it. Each reflector also adds its cluster's ID to the <Term means="A BGP attribute listing the clusters a route was reflected through. A reflector that finds its own cluster ID in it drops the route.">CLUSTER_LIST</Term>, and a reflector that finds its own ID there drops the route.

A single reflector is a single point of failure, as the widget showed: when it fails, its clients hear nothing from each other. So reflectors come in pairs, both with the same cluster ID, and every client has a session with both.

A reflector also changes what its clients see. It picks its own best route to each prefix and reflects only that one, so a client chooses its way out from the reflector's point of view, not its own. A client far from the reflector may then leave the network through an exit that is near the reflector but far from itself. The usual answer is to place reflectors so they see what their clients see: a pair in each point of presence for the routers there, with every reflector in a full mesh with the others.

::: warning Circuit has no route reflector setting
Circuit's schema has no field to make a router a route reflector, to mark a neighbor as its client, or to set a cluster ID. A network written in Circuit today runs iBGP as a full mesh, as the full-setup example does between its three edge routers. That is fine at a handful of routers, which is the size of network the example is.
:::

<Quiz
  question="Two route reflectors serve 30 clients. Each client has a session with both reflectors, and the reflectors have a session with each other. How many iBGP sessions does the AS have?"
  :choices="['32', '61', '496']"
  :answer="1"
  :why="['That counts each router once. Each client has two sessions, one to each reflector.', '', 'That is a full mesh of 32 routers, 32 x 31 / 2. Reflectors exist to avoid it.']"
  explain="30 clients x 2 reflectors = 60 sessions, plus 1 between the reflectors, makes 61. A full mesh of the same 32 routers would need 496."
/>

## Sessions between loopbacks

An iBGP session should not depend on any one link. So it runs between <Term means="An interface that belongs to no cable and is always up. Its address stays reachable as long as any path to the router works.">loopbacks</Term>: each router has a /32 address on a loopback, OSPF announces it, and the session runs from one loopback to the other. When a link fails, OSPF finds another way to the far loopback, and the session's packets take it. The session never notices.

OSPF here is the network's <Term means="Interior gateway protocol: the routing protocol that runs inside one network and carries its own addresses, such as OSPF. BGP carries the routes to the rest of the internet.">IGP</Term>. Its job is small and fast: carry the loopbacks and the links between your routers. BGP carries everything else, the internet's routes included, so OSPF never has to carry the full table.

In Circuit, `local_address` sets the address a session starts from. Without it, the router uses the address of the interface the packet leaves through, which changes when the path changes. This is one of three edge routers in a full mesh:

```ts
interfaces: {
    loopback: { type: "loopback", description: "Router ID and iBGP", addresses: ["10.255.0.1/32"] },
},

routing: {
    router_id: "10.255.0.1",
    bgp: {
        asn: 64500,
        groups: {
            ibgp: { remote_as: 64500, local_address: "10.255.0.1", import: "IBGP-IN", export: "IBGP-OUT" },
        },
        neighbors: {
            "edge-a2": { address: "10.255.0.2", group: "ibgp" },
            "edge-b1": { address: "10.255.0.3", group: "ibgp" },
        },
    },
    ospf: {
        areas: {
            "0.0.0.0": {
                interfaces: {
                    loopback: { passive: true },
                    "100g-1": { cost: 10, network: "point-to-point", bfd: true },
                    "100g-2": { cost: 10, network: "point-to-point", bfd: true },
                },
            },
        },
    },
},
```

The group holds what every iBGP session shares: the AS, which makes the session internal, the loopback to start from, and the policies. Each neighbor is then one line. The full-setup example does the same, with `local_address` on each neighbor and one session per address family.

`circuit validate` checks the mesh across devices. A missing session on one side, or a session that starts from an address the far end does not expect, is an error before anything reaches a router:

```text
error  edge-a1: neighbor edge-b1: edge-b1 has no session back to edge-a1
error  edge-a2: neighbor edge-a1: starts from 10.254.0.1, and edge-a1's session edge-a2 expects 10.255.0.2
```

The input firewall must let TCP port 179 in from the other loopbacks too. The full-setup example builds its `bgp-neighbors` address set from every neighbor of the router, the internal ones included.

## The next hop must be reachable

When an edge router passes a route from its transit provider to its iBGP neighbors, it leaves the next hop as it was: the transit provider's address, on the link between them. Every other router must have a route to that address, or it cannot use the route at all. There are two ways to give it one:

1. **Carry the outside links in the IGP.** The edge router announces its link to the transit into OSPF, so every router knows the way to the transit's address. The full-setup example does this with `redistribute: ["connected", "static"]` on its edge routers.
2. **Next-hop-self.** The edge router replaces the next hop with its own loopback as it passes the route on, so every route points at a loopback that OSPF already carries. This is called <Term means="An edge router replacing the next hop of the routes it passes on over iBGP with its own loopback address.">next-hop-self</Term>.

Circuit has no next-hop-self setting, so in Circuit the first way is the one to write.

<Quiz
  question="edge-a1 learns 192.0.2.0/24 from its transit, next hop 203.0.113.1, and passes it to edge-b1 over iBGP. edge-b1 has no route to 203.0.113.0/30. What does edge-b1 do with 192.0.2.0/24?"
  :choices="['Sends the traffic to edge-a1 anyway, since that is where the route came from', 'Cannot use the route, since it has no way to the next hop', 'Sends the traffic to 203.0.113.1 through its own transit']"
  :answer="1"
  :why="['The route says to send the traffic to 203.0.113.1, not to edge-a1. Without a route to that address, edge-b1 does not know which way to send it.', '', 'The next hop is on edge-a1 link to its transit. edge-b1 has no link there.']"
  explain="A route whose next hop cannot be reached is not used. Carry edge-a1's link to the transit in OSPF, or have edge-a1 set its own loopback as the next hop."
/>

## Fast: ECMP and BFD

Two things make an iBGP network quick on its feet, and both live in the IGP, not in BGP.

**ECMP.** A router reaches a BGP next hop through the paths OSPF finds to it. When two of those paths cost the same, OSPF can install both, and the traffic for every BGP route through that next hop is shared between them, as in a leaf-spine fabric. In Circuit, that comes from equal `cost` values on the OSPF interfaces. Circuit has no field for BGP multipath, which would share traffic between routes through different next hops.

**BFD.** OSPF notices a dead neighbor when its hellos stop. With the standard's sample values, hellos every 10 seconds and a neighbor declared dead after four missed, that is 40 seconds. When a cable is cut, the port goes down and the router knows at once. But when the failure is somewhere in the middle, in a switch or inside a provider's circuit, both ports stay up, and only the missing hellos tell. <Term means="Bidirectional Forwarding Detection: two routers send each other small packets many times a second, and declare the path dead after a few are missed, then tell OSPF or BGP.">BFD</Term> sends small packets many times a second, and declares the path dead after a few are missed, which can take less than a second.

<TryIt title="Break the link between two routers">

R1 and R2 run iBGP. Make the switch between them fail with BFD off, then on. Then try a cable straight between them, and a session between the link's own addresses instead of the loopbacks.

<FailoverClock />

</TryIt>

With loopbacks, the session never went down: OSPF found the way through R3 long before BGP's hold time, 90 seconds by the standard's suggestion, ran out. All BFD changed was how long traffic was lost. With the link's own addresses, the session died with the link, and every route learned through it was withdrawn and had to be sent again.

That is also why BFD belongs on the OSPF interfaces between your routers, and on eBGP sessions to other networks, but not on iBGP sessions between loopbacks. The standard for using BFD with routing protocols says so: when iBGP depends on OSPF, OSPF should hear about the failure and heal the path, and iBGP gains nothing from tearing down a session that OSPF is about to save. The full-setup example follows it: `bfd: true` on its OSPF links and on its session with transit A, none on its iBGP sessions. In Circuit, `bfd: true` turns BFD on; its timers are the platform's own defaults.

<Quiz
  question="Your routers run iBGP between loopbacks, with OSPF and BFD on every link between them. A link fails. What happens to the iBGP sessions that were using it?"
  :choices="['They go down and come back up when OSPF finds another way', 'They stay up, and their packets take the new way OSPF finds', 'They stay down until the link is repaired']"
  :answer="1"
  :why="['BFD tells OSPF, not iBGP. OSPF finds another way to the loopbacks in about a second, long before the hold time runs out, so the sessions never notice.', '', 'A loopback address is reachable over any path. Only a session between the link own addresses depends on the link.']"
  explain="BFD makes OSPF notice in under a second, OSPF finds another path to the far loopback, and the iBGP session carries on over it. No route is withdrawn."
/>

## An MTU that fits

The <Term means="Maximum transmission unit: the largest packet, in bytes, an interface sends without splitting it. In Circuit, 1500 when not set.">MTU</Term> of a link must be the same at both ends. When it is not, the trouble hides until there is a lot to send:

- **OSPF** neighbors describe their maps to each other in large packets, and the standard has a router reject one whose MTU is larger than its own interface takes. The neighbors see each other's hellos and then stop short of exchanging their maps.
- **BGP** sessions come up, since the first messages are small, and then fail when the routers start sending each other the full table in large packets. The small keepalives get through, the large updates do not, nothing useful arrives, and the session is torn down when the hold time runs out, only to come up and fail the same way again.

Raising the MTU on the links between your own routers to around 9000 bytes, a <Term means="A frame larger than the usual 1500 bytes, often around 9000, used on links between a network's own devices.">jumbo frame</Term>, leaves room for a tunnel added later to still carry a full 1500-byte packet. The full-setup example sets `mtu: 9000` on the link between its two site A edge routers, and a lower MTU on each of its tunnels to site B, by as much as the tunnel's own headers take: 1476 on one, 1450 on the other.

`circuit validate` compares the MTU at both ends of every cable that `link` names, and refuses a mismatch:

```text
error  edge-a1: port 100g-2 link: MTU 9000 on 100g-2, and edge-b1 100g-1 has 1500
```

## Further reading

- [RFC 4271: BGP-4](https://www.rfc-editor.org/rfc/rfc4271.html), section 9.2 on not passing iBGP routes on, section 5.1.3 on the next hop, and section 10 on the hold time.
- [RFC 4456: BGP Route Reflection](https://www.rfc-editor.org/rfc/rfc4456.html): clients and non-clients, ORIGINATOR_ID and CLUSTER_LIST, redundant reflectors, and where to place them.
- [RFC 5880: Bidirectional Forwarding Detection](https://www.rfc-editor.org/rfc/rfc5880.html), on why hellos are too slow and how BFD detects a failure.
- [RFC 5882: Generic Application of BFD](https://www.rfc-editor.org/rfc/rfc5882.html), section 4.4 and 10.2, on using BFD with OSPF and eBGP rather than iBGP.
- [RFC 2328: OSPF Version 2](https://www.rfc-editor.org/rfc/rfc2328.html), section 10.6 on the MTU check, and appendix C on hello and dead intervals.
- [BGP flapping: why a peer keeps resetting](https://www.netdata.cloud/guides/network/network-bgp-flapping/), Netdata's guide, on sessions that come up and then fail when large updates are dropped.
- [The full-setup example](https://github.com/takodotid/circuit/tree/main/examples/full-setup), whose three edge routers run iBGP in a full mesh between loopbacks.

## In short

- A router does not pass on routes learned over iBGP to other iBGP neighbors, so every router needs a full mesh of n(n-1)/2 sessions, or route reflectors that pass routes on for their clients.
- Reflectors come in pairs and reflect only their best route, so place them near their clients. Circuit has no route reflector setting yet; write a full mesh.
- Run iBGP between loopbacks with `local_address`, and let OSPF carry the loopbacks, so no single link takes a session down.
- Make the next hop reachable: carry the outside links in OSPF, or use next-hop-self, which Circuit does not have.
- Put BFD on the OSPF links and eBGP sessions, share equal paths with equal OSPF costs, and keep the MTU the same at both ends of every link.
