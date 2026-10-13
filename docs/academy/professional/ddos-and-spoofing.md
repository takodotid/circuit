---
title: Attacks on the network
description: Stop forged sources at your edge, shed a flood by blackholing its target at your upstreams, and keep the router's own CPU out of reach.
---

# Attacks on the network

A <Term means="Distributed denial of service: an attack that sends a target more traffic than its links or its devices can take, from many sources at once.">DDoS</Term>, a distributed denial of service attack, sends a target more traffic than its links or its devices can take, from many sources at once. A provider meets it from both sides: its customers are attacked, and its own network can be used to attack others.

Three defences work at three different places:

1. **At the edge of every network, drop packets with forged sources**, so floods cannot be launched from yours.
2. **When a flood arrives, drop it as far upstream as you can**, by blackholing the address it is aimed at.
3. **On every router, filter what reaches its own CPU**, so a flood cannot take routing down with it.

## Forged sources and reflection

The source address of a packet is written by its sender. Nothing on the way checks it, unless a router is set to. An attacker who forges, or <Term means="Writing a source address on a packet that is not the sender's own.">spoofs</Term>, a source can do something worse than hide: it can make other servers attack for it.

Some services answer a small UDP request with a much larger reply. The attacker sends requests to thousands of such servers, called <Term means="A server that answers whoever the source address of a request names, so an attacker can bounce traffic off it toward a victim.">reflectors</Term>, with the victim's address as the source, and every reply goes to the victim. CISA, the Cybersecurity and Infrastructure Security Agency of the United States, lists how many times larger the replies are: 28 to 54 times for DNS, about 557 for <Term means="Network Time Protocol: how devices ask a server for the time, over UDP port 123.">NTP</Term>, and 10,000 to 51,000 for <Term means="A program that keeps data in memory for web servers. Left open to the internet, it answers on UDP port 11211.">memcached</Term>.

<TryIt title="Bounce a flood off a reflector">

Send the requests with the victim's address as the source, and read how much arrives. Then use the attacker's own address. Then turn on the source check at Network S's edge, and send again.

<SpoofReflect />

</TryIt>

The check that stopped the flood ran in Network S, not at the victim and not at the reflector. That is **BCP 38**, Best Current Practice 38, published as RFC 2827 in 2000: a provider drops traffic from its customers whose source is outside the space those customers hold. It protects everyone else, never the network that runs it, which is why it only works when most networks do it, and why MANRS lists it as one of its actions.

Routers can make the check automatic with <Term means="Unicast reverse path forwarding: a router accepts a packet only if its routing table would send traffic for the packet's source back out the same way, or at all.">uRPF</Term>, unicast reverse path forwarding, described in RFC 3704 (BCP 84):

| Mode     | The router accepts a packet when                                         | Where it fits                                                                                    |
| -------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| Strict   | its route back to the source leaves through the same interface           | A customer link with one way in and out. MANRS calls it the easiest way for most small networks. |
| Feasible | any route it knows to the source, not only the best, uses that interface | A customer with several links to you                                                             |
| Loose    | it has any route to the source at all                                    | Hardly anywhere: RFC 3704 recommends it only as a way to measure                                 |

<Quiz
  question="Your network checks the source of every packet from its customers, as BCP 38 asks. Who does that protect?"
  :choices="['Your own customers, from floods aimed at them', 'Everyone else on the internet, from floods launched from your network', 'Your router, from traffic to its CPU']"
  :answer="1"
  :why="['A flood aimed at your customers comes from other networks, which your check never sees.', '', 'The check looks at traffic through the router, from customers. Protecting the CPU is a different filter.']"
  explain="The check stops forged packets as they leave your customers, so nobody can use your network to reflect a flood at a victim elsewhere. You are protected when the other networks do the same."
/>

## Anti-spoofing in Circuit

Circuit has no field for uRPF. You write the same check as a list, in the router's switch chip, with an ACL on each customer port: the customer's own space and its end of the link are accepted, and any other source is dropped.

```ts
ports: {
    "25g-3": { description: "Acme", access_vlan: "acme", acl: "from-acme" },
},

acls: {
    // Acme may only send from its own space, and from its end of the link.
    "from-acme": [
        { description: "Acme's own IPv4", match: { src: "192.0.2.0/24" }, action: "accept" },
        { description: "Acme's end of the link", match: { src: "198.51.100.252/30" }, action: "accept" },
        { description: "Any other IPv4 source", match: { family: "ipv4" }, action: "drop" },
    ],
},
```

Write the IPv6 rules the same way, and keep accepting link-local sources, `fe80::/10`, which IPv6 neighbor discovery uses on the link, as RFC 4861 says.

The other direction is the `antiSpoofing` preset from [Presets](/guide/presets#edge-filters), on the ports toward your transits and exchanges: traffic arriving from the internet that claims to come from your own space, a private range or a martian is dropped. The [edge router template](/patterns/edge-router) has both of its outside ports filtered this way.

## Shedding a flood

On 28 February 2018 at 17:21 UTC, GitHub received a memcached reflection flood that peaked at 1.35 Tbit/s and 126.9 million packets a second. Its links to its transits could not carry it. At 17:26 GitHub withdrew its routes from its transits and announced them only over its links to Akamai, a DDoS protection provider, so the flood went to Akamai's network instead; after the routes settled, access control lists stopped the attack. By 17:30 the site was back. GitHub's own report tells the story.

The lesson is about where the flood is dropped. A filter on your own router acts only after the flood has crossed your links from your upstreams, and when those are full, everyone behind them loses packets, not only the target. The flood has to be dropped on the far side of those links.

**Remote triggered blackholing** is the tool every provider has for this. The address under attack is announced in BGP as a <Term means="A route for one single address: a /32 in IPv4, a /128 in IPv6.">host route</Term>, a /32 or a /128, with a <Term means="A community that asks the network receiving the route to drop all traffic toward it. RFC 7999 reserves 65535:666 for it.">blackhole community</Term>, and the network receiving it drops all traffic toward that address. RFC 7999 reserves `65535:666` for it, and asks the receiver to keep the route inside its own network. Whether an upstream takes blackholes is its own choice; one that does gives you the community to use.

<TryIt title="Blackhole the target, and see who stops sending">

Send a wave of the flood as it is. Then have Acme ask for a blackhole, and send again. Then list the transits that take blackholes, one at a time, and watch the link meters.

<BlackholeFlood />

</TryIt>

A blackhole on your own router freed Acme's link, and nothing else. Each transit that received the route freed your link to it. The exchange takes no blackholes in this widget, so its share kept arriving, and your router dropped it. And in every case `192.0.2.10` became unreachable for everyone: blackholing gives up one address to save every other customer, which RFC 5635 says plainly. Acme can move its service to another address while the attack lasts.

In Circuit, blackholing is part of the [community scheme](/guide/communities#blackhole). The scheme names your blackhole community and every upstream that takes it:

```ts
export const communities = communityScheme({
    asn: 64500,
    learned_from: { function: 1, classes: { transit: 1, exchange: 2, customer: 3 } },
    // Transit A drops traffic to a route it receives with 65535:666. Transit B takes no blackholes, so it never receives the route.
    blackhole: { function: 666, upstreams: { 64501: "65535:666" } },
});
```

A customer's import takes a blackhole request first, before `SANITY` refuses anything longer than a /24, and only for an address inside the customer's own space, so it can never blackhole someone else:

```ts
"ACME-IN": [
    ...communities.blackhole(["acme-v4", "acme-v6"]),
    { call: "SANITY" },
    communities.tag("customer", 65550, { trusted: true }),
    { description: "Their IPv4", match: { prefix_set: "acme-v4" }, set: { local_pref: 300 }, action: "accept" },
    { description: "Their IPv6", match: { prefix_set: "acme-v6" }, set: { local_pref: 300 }, action: "accept" },
    { description: "Nothing else", action: "reject" },
],
```

`communities.actions(64501)` at the start of the export to Transit A then passes the route on with `65535:666`, and the export to every upstream not listed rejects it.

Blackholing drops everything toward the address, the attack and the customers of that service alike. <Term means="BGP flow specification: rules carried in BGP that match traffic by addresses, protocol, ports, packet length and more, and drop or rate-limit only what matches.">Flowspec</Term>, defined in RFC 8955, is the finer tool: a rule carried in BGP that matches the flood by protocol, ports or packet length, and drops or rate-limits only that. Circuit has no field for flowspec. On your own edge, the `antiAmplification` preset drops reflected floods by their source port in the switch chip, which saves your router, but not the link the flood arrived on.

<Quiz
  question="A flood of 30 Gbit/s toward one customer address arrives over your two 10 Gbit/s transit links. You blackhole the address on your own router only. What changes?"
  :choices="['Everything recovers, since the flood is dropped', 'The customer link is freed, but both transit links stay full', 'Nothing, since a blackhole only works upstream']"
  :answer="1"
  :why="['It is dropped after it has crossed your transit links, which it still fills, so every customer behind them still loses packets.', '', 'Your router does drop it, so the customer link is freed. The transit links are the part only an upstream can free.']"
  explain="Your router drops the flood, so it never reaches the customer link. But it still arrives over your transit links and fills them. Only an upstream that receives the blackhole route can free those."
/>

## Protecting the router itself

A flood aimed at the router's own address, or a flood of traffic the router must think about, reaches its CPU, the same CPU that runs BGP. If it falls behind, sessions drop, and the whole network loses its routes. RFC 6192 gives the rule: decide what traffic the router itself needs, such as BGP from its neighbors and management from your own networks, and filter everything else that is addressed to it.

In Circuit, that is the input chain, with `default: "drop"`, as the [edge router template](/patterns/edge-router) writes it. Three more things help on RouterOS, all from what was found on a real router and written on the [RouterOS platform page](/platforms/routeros):

- **Drop in the switch chip what you can recognise.** An ACL drop never reaches the CPU. A `rate` on a switch-chip rule did not limit traffic the CPU routes, so drop instead of limiting.
- **Keep floods out of the <Term means="The list a stateful firewall keeps of every connection passing through it, so it can recognise replies and established traffic.">connection table</Term>.** The connection table of a CCR2216, the router the RouterOS adapter was proven on, holds 1,048,576 entries, and a full table refuses every new connection through the router, not only the target's. A <Term means="A flood of TCP SYN packets, the first packet of a connection, from addresses that never finish the handshake, so the receiver keeps waiting on each.">SYN flood</Term> of 210,000 packets a second filled it in five seconds. Traffic to and from prefixes in `untracked` never enters it.
- **Answer SYN floods with <Term means="A way to answer a TCP SYN without remembering it: the details are encoded in the reply, and checked only if the sender completes the handshake.">SYN cookies</Term>**, `system.ip.syn_cookies`, so the router does not keep state for half-open connections to itself.

```ts
system: { ip: { syn_cookies: true } },

firewall: {
    // Acme's servers: a flood toward them never fills the connection table.
    untracked: ["192.0.2.0/24"],
    address_sets: { "bgp-neighbors": ["203.0.113.1", "203.0.113.129", "198.51.100.254", "2001:db8:100:ff01::2"] },
    filter: {
        input: {
            default: "drop",
            rules: [
                { description: "Replies", match: { state: ["established", "related"] }, action: "accept" },
                { description: "Ping", match: { protocol: "icmp" }, action: "accept" },
                { description: "Management", match: { src: "10.0.0.0/24" }, action: "accept" },
                { description: "BGP", match: { protocol: "tcp", dst_port: 179, src_set: "bgp-neighbors" }, action: "accept" },
            ],
        },
        forward: { rules: [...badTcpFlags()] },
    },
},
```

A forward chain that drops by default must also accept the state `untracked`, since no other state applies to that traffic.

<Quiz
  question="Your input chain ends in default drop, and accepts BGP only from your neighbors. A flood of TCP to port 179 arrives at the router from thousands of other addresses. What happens to it?"
  :choices="['It is dropped by the input chain, and the BGP sessions stay up', 'It opens thousands of BGP sessions', 'It is passed to the neighbors']"
  :answer="0"
  :why="['', 'A session needs the TCP connection first, and the input chain drops these before any connection exists.', 'Traffic addressed to the router is for the router itself. It goes through the input chain, not on to anyone.']"
  explain="The rule for BGP accepts port 179 only from the bgp-neighbors set. Everything else addressed to the router falls to default drop. For a flood large enough to load the CPU anyway, drop it in the switch chip with an ACL."
/>

## Further reading

- [RFC 2827, Network Ingress Filtering (BCP 38)](https://www.rfc-editor.org/rfc/rfc2827).
- [RFC 3704, Ingress Filtering for Multihomed Networks (BCP 84)](https://www.rfc-editor.org/rfc/rfc3704): strict, feasible and loose uRPF.
- [CISA, UDP-Based Amplification Attacks](https://www.cisa.gov/news-events/alerts/2014/01/17/udp-based-amplification-attacks): the amplification factors.
- [GitHub, February 28th DDoS Incident Report](https://github.blog/2018-03-01-ddos-incident-report/).
- [RFC 5635, Remote Triggered Black Hole Filtering with uRPF](https://www.rfc-editor.org/rfc/rfc5635).
- [RFC 7999, BLACKHOLE Community](https://www.rfc-editor.org/rfc/rfc7999).
- [RFC 8955, Dissemination of Flow Specification Rules](https://www.rfc-editor.org/rfc/rfc8955).
- [RFC 6192, Protecting the Router Control Plane](https://www.rfc-editor.org/rfc/rfc6192).
- [RFC 4861, Neighbor Discovery for IPv6](https://www.rfc-editor.org/rfc/rfc4861).
- [MANRS implementation guide for network operators](https://manrs.org/netops/guide/), on anti-spoofing.

## In short

- Spoofed sources let one attacker reflect and amplify a flood off thousands of servers. BCP 38 stops it in the sender's network: drop customer traffic from outside the customer's space, by uRPF or, in Circuit, an ACL on the customer port.
- A flood larger than your links must be dropped upstream. Blackholing announces the target's /32 with a community; every upstream that takes it drops the flood in its own network. The target becomes unreachable, and everyone else is saved.
- In Circuit, `communityScheme` names your blackhole community and the upstreams that take it, and `communities.blackhole` lets a customer blackhole only its own space. Circuit has no flowspec.
- Protect the router's CPU: an input chain that ends in drop, ACL drops in the switch chip, `untracked` for customer space, and SYN cookies.
