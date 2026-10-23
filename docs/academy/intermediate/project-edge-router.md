---
title: "Project: an edge router"
description: Build Circuit's edge router step by step, from your AS number to the firewall, make its decisions yourself, then validate and diff it.
---

# Project: an edge router

In this project you build the router that joins your network to the internet. It announces your own address space under your own AS number to a transit and at an internet exchange, filters the routes it takes in and the routes it sends out, and protects itself and your network from traffic that has no business arriving.

It is Circuit's [edge router pattern](/patterns/edge-router), and every lesson of this level has a part in it. You start the project, read each part of the router's file and what it does, make its key decisions yourself, then check it and see the plan.

## Start the project

```bash
npx @takodotid/circuit new my-network --pattern edge-router --asn 64500
```

It writes four files: `routing.ts` with your AS number and communities, `edge-01.ts` with the router, `checks.ts` with rules of your own, and `circuit.config.ts`, which joins them into one network.

::: info The names in this lesson
The template's files use a well-known transit and exchange as stand-ins for your own. This lesson calls them simply the transit, AS64510, and the exchange, whose route servers are AS64511, and uses the neighbor names `transit`, `ix-rs-v4` and `ix-rs-v6`. Replace the addresses, AS numbers and port names with the ones your providers give you.
:::

## Your AS and its communities

`routing.ts` says what your network is on the internet: the AS number from [Networks of networks](/academy/intermediate/autonomous-systems), and the meaning of your communities from [Route policies](/academy/intermediate/route-policy).

```ts
/** Your AS number. */
export const ASN = 64500;

/** What your BGP communities mean. The router tags each route it learns with them, and `circuit communities` publishes them. */
export const communities = Bgp.communityScheme({
    asn: ASN,
    learned_from: { function: 1, classes: { transit: 1, exchange: 2 } },
    learned_from_as: 3,
});
```

## The transit and the exchange

Each neighbor arrives on its own port, untagged in its own VLAN, as in [VLANs](/academy/elementary/vlans). The router has an address on each: a /30 from the transit, and an IPv4 and an [IPv6](/academy/intermediate/ipv6) address on the exchange's shared peering LAN. Both ports use the `edge` ACL, which comes later.

```ts
vlans: {
    transit: { id: 300, description: "IP transit from your provider, AS64510" },
    ix: { id: 200, description: "Peering LAN of the exchange" },
},

ports: {
    "1g-1": { description: "Management", addresses: ["10.0.0.1/24"] },
    "25g-1": { description: "Transit", access_vlan: "transit", acl: "edge" },
    "25g-2": { description: "Exchange", access_vlan: "ix", acl: "edge" },
},

interfaces: {
    transit: { type: "vlan", vlan: "transit", addresses: ["203.0.113.2/30"] },
    ix: { type: "vlan", vlan: "ix", addresses: ["192.0.2.10/24", "2001:db8:ffff::10/64"] },
},
```

## Your prefixes and the BGP sessions

`OURS` lists your two blocks. `networks` tells BGP to originate them, but BGP only announces a prefix that is in the routing table. A blackhole static route, from [Routing tables](/academy/intermediate/routing-tables), puts each block there even when nothing inside it is up. The networks you do use inside the block have longer prefixes, so by the longest match their traffic still reaches them, and only traffic to unused addresses is dropped.

```ts
// Near the top of edge-01.ts
const OURS = ["198.51.100.0/24", "2001:db8:100::/48"] as const satisfies readonly Prefix[];

// Inside defineDevice({ ... })
routing: {
    router_id: "203.0.113.2",
    // A route for each block we announce, so it is in the table even when nothing inside it is up.
    static: OURS.map((prefix) => ({ prefix, blackhole: true, description: "Originate" })),
    bgp: {
        asn: ASN,
        networks: [...OURS],
        neighbors: {
            transit: {
                address: "203.0.113.1",
                remote_as: 64510,
                role: "provider",
                import: "TRANSIT-IN",
                export: "OUT",
                max_prefixes: 1_200_000,
            },
            "ix-rs-v4": {
                address: "192.0.2.1",
                remote_as: 64511,
                role: "rs",
                import: "IX-IN",
                export: "OUT",
                max_prefixes: 100_000,
            },
            "ix-rs-v6": {
                address: "2001:db8:ffff::1",
                remote_as: 64511,
                role: "rs",
                import: "IX-IN",
                export: "OUT",
                max_prefixes: 50_000,
            },
        },
    },
},
```

There are three sessions, as in [BGP](/academy/intermediate/bgp): one with the transit, and one per address family with the exchange's route server, which passes on the routes of every member that peers with it. `role` tells each side what the other is, and `max_prefixes` is the fuse from [Route policies](/academy/intermediate/route-policy).

<Quiz
  question="Why does the router have a blackhole route for 198.51.100.0/24, its own block?"
  :choices="['To drop all traffic to the block', 'So the block is always in the routing table, and BGP always announces it', 'Because BGP needs a blackhole to start a session']"
  :answer="1"
  :why="['Traffic to the parts of the block in use follows their longer prefixes. Only unused addresses fall through to the blackhole.', '', 'Sessions start without it. The route is about what BGP may announce.']"
  explain="BGP announces only prefixes in the routing table. The blackhole route keeps the block there at all times, while longer routes inside it carry traffic to what is in use."
/>

## The policies

Every import calls `SANITY`, tags the route with where it came from, sets a local preference and accepts. The exchange's 200 against the transit's 100 is the choice from [Choosing the best route](/academy/intermediate/best-path). The export accepts your two blocks and rejects the rest.

```ts
policies: {
    SANITY: Bgp.sanity(),
    // A route from the exchange is preferred over the same route from the transit: higher local preference wins.
    "TRANSIT-IN": [{ call: "SANITY" }, communities.tag("transit", 64510), { set: { local_pref: 100 } }, { action: "accept" }],
    "IX-IN": [{ call: "SANITY" }, communities.tag("exchange", 64511), { set: { local_pref: 200 } }, { action: "accept" }],
    OUT: [
        ...OURS.map((prefix) => ({ description: `Announce ${prefix}`, match: { prefix }, action: "accept" as const })),
        { description: "Nothing else leaves", action: "reject" },
    ],
},
```

## Protecting the router

The router is on the internet, so anyone can send it packets. Its input chain, as in [Firewalls](/academy/elementary/firewall), drops everything except replies, ping, the management network from [Keeping the keys](/academy/elementary/management), and BGP from the three neighbors' addresses. The forward chain drops TCP packets with flag combinations no real program sends.

```ts
firewall: {
    address_sets: { "bgp-neighbors": ["203.0.113.1", "192.0.2.1", "2001:db8:ffff::1"] },
    filter: {
        input: {
            default: "drop",
            rules: [
                { description: "Replies", match: { state: ["established", "related"] }, action: "accept" },
                { description: "Ping", match: { protocol: "icmp" }, action: "accept" },
                { description: "Management", match: { src: MANAGEMENT }, action: "accept" },
                { description: "BGP", match: { protocol: "tcp", dst_port: 179, src_set: "bgp-neighbors" }, action: "accept" },
            ],
        },
        forward: { rules: [...Filters.badTcpFlags()] },
    },
},

// In the switch chip, before a packet reaches the router's CPU.
acls: { edge: [...Filters.antiSpoofing("transit", SPOOFED), ...Filters.antiSpoofing("ix", SPOOFED)] },
```

`SPOOFED` is your own IPv4 block, the martians and the private ranges. A packet from outside whose source is one of those is forged, because no such sender can be out there. `Filters.antiSpoofing` drops it in the switch chip, so a flood of them never costs the router's CPU anything.

<Quiz
  question="A packet arrives from the transit with the source address 198.51.100.7. What happens to it?"
  :choices="['It is routed to 198.51.100.7', 'The edge ACL drops it, because that address is inside your own block', 'The input chain accepts it as a reply']"
  :answer="1"
  :why="['Its destination decides where it goes, not its source. And it never gets that far.', '', 'The ACL acts in the switch chip, before the firewall ever sees the packet.']"
  explain="198.51.100.7 is inside 198.51.100.0/24, your own block. A packet from outside cannot really come from there, so it is forged, and the edge ACL drops it on arrival."
/>

## Your own checks

`checks.ts` adds three rules to Circuit's own, and `circuit validate` runs them all: every export ends in a reject (`Checks.exportsEndInReject`), traffic from the transit and exchange VLANs reaches the rest of the network only through the router (`Checks.trustBoundary`), and every BGP session has an import policy. `circuit.config.ts` lists the router, the checks, your AS number and your communities.

## Make the decisions yourself

<TryIt title="Decide what the router does">

Make the template's four decisions, good or bad, and see the part of `edge-01.ts` each one writes and what `circuit validate` prints. The output is what validate printed for each combination, run on the template.

<EdgeDecisions />

</TryIt>

Two of the bad choices fail validation, because the template's checks were written for them. The others pass: a file can be perfectly valid and still accept every route a transit sends you. The checks catch the mistakes someone thought of; the rest is on you.

## Validate, diff and apply

1. Put the router's password in `.env` as `EDGE_01_PASSWORD`, then run `npx circuit secrets` to see that it can be read.
2. Run `npx circuit validate`. On the template it prints `1 device(s), no errors.`
3. Run `npx circuit snapshot`. It logs in to the router and saves what it runs now in `.circuit/state/`, changing nothing.
4. Run `npx circuit diff`. It compares your files with that snapshot, offline.
5. Run `npx circuit apply edge-01`. It reads the router again and shows the plan against what it runs right now. Read every line, then run it again with `--confirm` to send it. On RouterOS, Junos and FortiOS, the router undoes the change by itself if Circuit cannot log in again within 10 minutes, unless you choose another time with `--rollback`.
6. Commit the files together with the new snapshot.

Once the router runs the template, a later change shows as a short plan. Here the limit for the exchange's IPv4 route server goes from 100,000 to 150,000:

```
edge-01: 1 command(s) in 1 step(s)
  /routing bgp connection
    ~ {"remote.address":"192.0.2.1/32"} input.limit-process-routes-ipv4=150000
```

`~` marks a change to something the router already has. A change inside a policy looks bigger, because policy rules run in order. When the exchange's local preference goes from 200 to 150, the plan removes every filter rule on the router and adds them all again in the order of your file, so each rule is listed twice, once with `-` and once with `+`.

Before your routes travel far, your transit and the exchange's route servers must know they are yours. They filter what you send them by the records of an internet routing registry, and many check RPKI too, so publish a route object and a ROA for each block first. [Selling IP transit](/use-cases/ip-transit#tell-your-upstreams) walks through it.

<Quiz
  question="You run circuit diff and it prints edge-01: matches. Does that prove nobody changed the router by hand?"
  :choices="['Yes, diff reads the router', 'No, diff compares your files with the last snapshot, not with the router itself', 'Yes, because validate passed']"
  :answer="1"
  :why="['diff never logs in. It works offline, from the snapshot in .circuit/state/.', '', 'validate only checks your files. It never sees the router.']"
  explain="diff compares your files with the last snapshot, so a change made by hand after that snapshot is invisible to it. apply always reads the router again first."
/>

## Where to go from here

The template is one router with one transit. The rest of this level shows how it grows: a second transit, with [prepending](/academy/intermediate/best-path) to steer traffic coming in; a LAG to each provider, so one cable can fail, from [Staying up](/academy/intermediate/redundancy); a second edge router that shares routes with this one over iBGP, with OSPF from [Routers that talk](/academy/intermediate/ospf) finding the way between them. To sell transit to customers of your own, see [Selling IP transit](/use-cases/ip-transit).

## In short

- `circuit new --pattern edge-router` writes a router that announces your blocks to a transit and an exchange.
- Blackhole routes keep your blocks in the routing table, and `networks` announces them.
- Every import runs `SANITY`, tags the route and sets a local preference, with the exchange at 200. The export accepts your blocks and rejects the rest.
- The input firewall allows BGP only from the neighbors, and the edge ACL drops forged sources in the switch chip.
- `validate` runs Circuit's checks and yours, `diff` shows the plan against the last snapshot, and `apply --confirm` sends it.
