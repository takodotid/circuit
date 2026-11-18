---
title: BGP inside a network
description: Run iBGP between loopbacks over OSPF, count the sessions a full mesh needs against route reflectors, and keep it fast and whole with ECMP, BFD, and the same MTU at both ends of a link.
---

# BGP inside a network

Every router in your AS that must know the routes from outside runs iBGP with the others.

## Why iBGP needs a full mesh

Between ASes, the AS path stops loops: a router drops a route that already has its own AS number in it. Inside one AS, the path doesn't grow, since the route never leaves the AS, so it can't show a loop. The BGP standard settles it with a rule instead. A router that receives a route from an internal neighbor doesn't pass it on to other internal neighbors.

So a route learned at one edge router reaches only the routers that have a session with that edge router. For every router to learn every route, every router needs a session with every other. That is a <Term means="A design in which every router has a session with every other router. With n routers, that is n(n-1)/2 sessions.">full mesh</Term>, and it grows fast: with n routers, it takes n(n-1)/2 sessions.

<TryIt title="Count the sessions a network needs">

After you add routers, fail a reflector with one reflector, and again with two.

<ReflectorCount />

</TryIt>

At 50 routers, a full mesh has 1,225 sessions, and one new router changes 50 device files at once.

<Quiz
  question="An AS has 20 routers that run BGP, in a full mesh. How many iBGP sessions is that?"
  :choices="['20', '190', '380']"
  :answer="1"
  :why="['That would be one session per router. Each router has 19 sessions, one to each of the others.', '', 'That counts every session twice, once from each end. Divide by two: 20 x 19 / 2.']"
  explain="Each of the 20 routers has a session with the 19 others, and each session joins two routers, so 20 x 19 / 2 = 190."
/>

## Route reflectors

A <Term means="A router that passes routes learned over iBGP on to other iBGP neighbors, its clients, so they need no full mesh. RR for short.">route reflector</Term> is a router allowed to break the rule: it passes iBGP routes on. Its iBGP neighbors are in two groups:

1. **Clients** have a session only with their reflectors. A route from a client is reflected to every other client and to every non-client.
2. **Non-clients** are ordinary iBGP neighbors, in a full mesh with each other and the reflectors. A route from a non-client is reflected to the clients only.

A reflector and its clients form a <Term means="A route reflector, or a pair of them, and the clients they serve. Each cluster has an ID that reflected routes carry.">cluster</Term>. When clients have sessions only with their reflectors, the count drops from n(n-1)/2 to about two per router. Each client has a session with each of its reflectors, and the reflectors have a full mesh among themselves.

Two attributes stop reflected routes from looping:

- A reflector writes the <Term means="A BGP attribute a route reflector adds: the router ID of the router in the AS that first announced the route. That router drops the route if it comes back.">ORIGINATOR_ID</Term>. The router with that ID drops the route if it ever comes back to it.
- Each reflector adds its cluster's ID to the <Term means="A BGP attribute that lists the clusters a route was reflected through. A route reflector that finds its own cluster ID in it drops the route.">CLUSTER_LIST</Term>. A reflector that finds its own ID there drops the route.

A single reflector is a single point of failure: when it fails, its clients hear nothing from each other. So reflectors come in pairs, both with the same cluster ID, and every client has a session with both.

A reflector also changes what its clients see. It picks its own best route to each prefix and reflects only that one. So a client chooses its way out from the reflector's point of view, not its own. A client far from the reflector may then leave the network through an exit near the reflector but far from itself. The usual answer is to place reflectors so they see what their clients see. Put a pair in each point of presence for the routers there, with every reflector in a full mesh with the others.

::: warning Circuit has no route reflector setting
Circuit can't make a router a route reflector, mark a client, or set a cluster ID. A network written in Circuit runs iBGP as a full mesh. That is fine for a handful of routers.
:::

<Quiz
  question="Two route reflectors serve 30 clients. Each client has a session with both reflectors, and the reflectors have a session with each other. How many iBGP sessions does the AS have?"
  :choices="['32', '61', '496']"
  :answer="1"
  :why="['That counts each router once. Each client has two sessions, one to each reflector.', '', 'That is a full mesh of 32 routers, 32 x 31 / 2. Reflectors exist to avoid it.']"
  explain="30 clients x 2 reflectors = 60 sessions, plus 1 between the reflectors, makes 61. A full mesh of the same 32 routers would need 496."
/>

## Sessions between loopbacks

An iBGP session shouldn't depend on any one link. So it runs between <Term means="An interface that belongs to no cable and is always up. Its address stays reachable as long as any path to the router works.">loopbacks</Term>. Each router has a /32 address on a loopback, and OSPF announces it. The session runs from one loopback to the other. When a link fails, OSPF finds another way to the far loopback, and the session's packets take it. The session never notices.

OSPF here is the network's <Term means="Interior gateway protocol: a routing protocol that runs inside one network and carries its own addresses, such as OSPF. BGP carries the routes to and from other networks.">IGP</Term>. Its job is small and fast: carry the loopbacks and the links between your routers. BGP carries everything else, including the routes of the internet, so OSPF never has to carry the full table.

In Circuit, `local_address` sets the address a session starts from. Without it, the router uses the address of the interface the packet leaves through, which changes when the path changes. This is one of three edge routers in a full mesh:

```ts
interfaces: {
    loopback: {
        loopback: { description: "Router ID and iBGP", addresses: ["10.255.0.1/32"] },
    },
},

routing: {
    router_id: "10.255.0.1",
    bgp: {
        neighbor_groups: {
            ibgp: { remote_as: 64500, local_address: "10.255.0.1", import_policy: "ibgp-import", export_policy: "ibgp-export" },
        },
        neighbors: {
            "edge-a2": { address: "10.255.0.2", neighbor_group: "ibgp" },
            "edge-b1": { address: "10.255.0.3", neighbor_group: "ibgp" },
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

The group holds what every iBGP session shares: the AS, which makes the session internal, the loopback to start from, and the policies. Each neighbor is then one line.

`circuit validate` checks the sessions across devices. A session with no session back, or one that starts from an address the far end doesn't expect, is an error before anything reaches a router:

```text
  error  edge-01: routing.bgp.neighbors.edge-02: starts from 10.255.0.1, and edge-02's routing.bgp.neighbors.edge-01 expects 192.0.2.96
```

The input firewall must let TCP port 179 in from the other loopbacks too. An address set of `bgpNeighbors()` holds every neighbor of the router, the internal ones included.

## The next hop must be reachable

An edge router passes a route from its transit provider on to its iBGP neighbors. It leaves the next hop as it was, the transit provider's address on the link between them. Every other router must have a route to that address, or it can't use the route at all. There are two ways to give it one:

1. **Carry the outside links in the IGP.** The edge router announces its link to the transit into OSPF, so every router knows the way to the transit's address. In Circuit, this is `redistribute: ["connected"]` in the edge router's `routing.ospf`.
2. **Next-hop-self.** The edge router replaces the next hop with its own loopback as it passes the route on. Then every route points at a loopback that OSPF already carries. This is called <Term means="An edge router writing its own address, usually its loopback, as the next hop of the routes it passes on over iBGP.">next-hop-self</Term>.

Circuit has no next-hop-self setting, so in Circuit you write the first way.

<Quiz
  question="edge-a1 learns 192.0.2.0/24 from its transit, next hop 203.0.113.1, and passes it to edge-b1 over iBGP. edge-b1 has no route to 203.0.113.0/30. What does edge-b1 do with 192.0.2.0/24?"
  :choices="['Sends the traffic to edge-a1 anyway, since that is where the route came from', 'Cannot use the route, since it has no way to the next hop', 'Sends the traffic to 203.0.113.1 through its own transit']"
  :answer="1"
  :why="['The route says to send the traffic to 203.0.113.1, not to edge-a1. Without a route to that address, edge-b1 does not know which way to send it.', '', 'The next hop is on the link from edge-a1 to its transit. edge-b1 has no link there.']"
  explain="A route whose next hop cannot be reached is not used. Carry the link from edge-a1 to the transit in OSPF, or have edge-a1 set its own loopback as the next hop."
/>

## Equal paths and fast failure detection

Two things make an iBGP network quick on its feet, and both live in the IGP, not in BGP.

**ECMP.** A router reaches a BGP next hop through the paths OSPF finds to it. When two of those paths cost the same, OSPF can install both. Then the traffic for every BGP route through that next hop is shared between them, as in a leaf-spine fabric. In Circuit, that comes from equal `cost` values on the OSPF interfaces. Circuit has no field for BGP multipath, which would share traffic between routes through different next hops.

**BFD.** OSPF notices a dead neighbor when its hellos stop. With the sample values of the standard, hellos every 10 seconds and a neighbor declared dead after four missed, that is 40 seconds. When a cable is cut, the port goes down and the router knows at once. But when the failure is somewhere in the middle, such as in a switch or inside a provider's circuit, both ports stay up. Only the missing hellos tell. <Term means="Bidirectional Forwarding Detection: two routers send each other small packets many times a second. When a few in a row are missed, BFD declares the path down and tells OSPF or BGP.">BFD</Term> sends small packets many times a second, and declares the path dead after a few are missed. This can take less than a second.

<TryIt title="Break the link between two routers">

<FailoverClock />

</TryIt>

BFD changed only how long traffic was lost, not whether the session between loopbacks survived. That is why BFD belongs on the OSPF interfaces between your routers, and on eBGP sessions to other networks, but not on iBGP sessions between loopbacks. The standard for BFD with routing protocols says so. When iBGP depends on OSPF, OSPF should hear about the failure and heal the path. iBGP gains nothing from tearing down a session that OSPF is about to save.

In Circuit, `bfd: true` on an OSPF interface or a BGP neighbor turns BFD on. `routing.bfd` sets its timers, and without it each platform uses its own. Junos has no default, so there Circuit sends a BFD packet every 300 ms.

<Quiz
  question="Your routers run iBGP between loopbacks, with OSPF and BFD on every link between them. A link fails. What happens to the iBGP sessions that were using it?"
  :choices="['They go down and come back up when OSPF finds another way', 'They stay up, and their packets take the new way OSPF finds', 'They stay down until the link is repaired']"
  :answer="1"
  :why="['BFD tells OSPF, not iBGP. OSPF finds another way to the loopbacks in about a second, long before the hold time runs out, so the sessions never notice.', '', 'A loopback address is reachable over any path. Only a session between the addresses of the link itself depends on the link.']"
  explain="BFD makes OSPF notice in under a second, OSPF finds another path to the far loopback, and the iBGP session carries on over it. No route is withdrawn."
/>

## The same MTU at both ends

The <Term means="Maximum transmission unit: the largest single piece of data a link carries, in bytes. On ordinary Ethernet it is 1,500 bytes.">MTU</Term> of a link must be the same at both ends. When it isn't, the trouble hides until there is a lot to send:

- **OSPF** neighbors describe their maps to each other in large packets. The standard has a router reject one whose MTU is larger than its own interface takes. The neighbors see each other's hellos, and then stop short of exchanging their maps.
- **BGP** sessions come up, because the first messages are small. Then they fail when the routers start sending each other the full table in large packets. The small keepalive messages get through, but the large updates don't. Nothing useful arrives, and the session is torn down when the hold time runs out. It comes up again, and fails the same way.

Raise the MTU on the links between your own routers to about 9,000 bytes, a <Term means="A frame that carries more than the usual 1,500 bytes, often about 9,000. Networks use jumbo frames on links between their own devices, such as inside a data center.">jumbo frame</Term>. This leaves room for a tunnel added later to still carry a full 1,500-byte packet.

`circuit validate` compares the MTU at both ends of every cable written with `link`, and stops on a mismatch:

```text
  error  edge-01: interfaces.ethernet.100g-1.link: MTU 9000 on interfaces.ethernet.100g-1, and edge-02 interfaces.ethernet.100g-1 has 1500
  error  edge-02: interfaces.ethernet.100g-1.link: MTU 1500 on interfaces.ethernet.100g-1, and edge-01 interfaces.ethernet.100g-1 has 9000
```

## Further reading

- [RFC 4271](https://www.rfc-editor.org/rfc/rfc4271.html), BGP-4: section 9.2 on not passing iBGP routes on, section 5.1.3 on the next hop, and section 10 on the hold time.
- [RFC 4456](https://www.rfc-editor.org/rfc/rfc4456.html), BGP route reflection: clients and non-clients, ORIGINATOR_ID and CLUSTER_LIST, redundant reflectors, and where to place them.
- [RFC 5880](https://www.rfc-editor.org/rfc/rfc5880.html), on why hellos are too slow and how BFD detects a failure.
- [RFC 5882](https://www.rfc-editor.org/rfc/rfc5882.html), sections 4.4 and 10.2: BFD with OSPF and eBGP, rather than with iBGP.
- [RFC 2328](https://www.rfc-editor.org/rfc/rfc2328.html), OSPF version 2: section 10.6 on the MTU check, and appendix C on hello and dead intervals.
- [BGP flapping: why a peer keeps resetting](https://www.netdata.cloud/guides/network/network-bgp-flapping/), a guide on sessions that come up and then fail when large updates are dropped.
