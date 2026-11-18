---
title: Attacks on the network
description: Stop forged sources at your edge, shed a flood by blackholing its target at your upstreams, and keep the router's own CPU out of reach.
---

# Attacks on the network

A <Term means="Distributed denial of service: an attack that sends a target more traffic than its links or devices can take, from many sources at once.">DDoS</Term>, a distributed denial of service attack, sends a target more traffic than its links or its devices can take, from many sources at once. A provider meets it from both sides. Its customers are attacked, and its own network can be used to attack others.

## Forged sources and reflection

The sender of a packet writes its source address. Nothing on the way checks it, unless a router is set to. An attacker who forges, or <Term means="Writing a source address on a packet that is not the sender's own.">spoofs</Term>, a source can do something worse than hide. It can make other servers attack for it.

Some services answer a small UDP request with a much larger reply. The attacker sends requests to thousands of such servers, called <Term means="In an attack, a server that sends its answer to the source address written on a request. The attacker writes the victim's address there, so the answers flood the victim.">reflectors</Term>, with the victim's address as the source. Every reply goes to the victim. CISA, the Cybersecurity and Infrastructure Security Agency of the United States, lists how many times larger the replies are:

- 28 to 54 times for DNS.
- About 557 times for <Term means="Network Time Protocol: how devices ask a server for the time, over UDP port 123.">NTP</Term>.
- 10,000 to 51,000 times for <Term means="A program that keeps data in memory for web servers. Left open to the internet, it answers on UDP port 11211.">memcached</Term>.

<TryIt title="Bounce a flood off a reflector">

<SpoofReflect />

</TryIt>

The check that stopped the flood ran in the attacker's own network, AS64511. That is **BCP 38**, Best Current Practice 38, published as RFC 2827 in 2000. A provider drops traffic from its customers when the source address is outside the customers' own address space.

BCP 38 protects everyone else, never the network that runs it. So it only works when most networks do it, and that is why MANRS lists it as one of its actions.

Routers can make the check automatic with <Term means="Unicast reverse path forwarding: a router accepts a packet only if its routing table has a route back to the packet's source. Strict mode also wants that route to go out the port the packet came in on.">uRPF</Term>, unicast reverse path forwarding, described in RFC 3704 (BCP 84):

| Mode     | The router accepts a packet when                                         | Where it fits                                                                                    |
| -------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| Strict   | its route back to the source leaves through the same interface           | A customer link with one way in and out. MANRS calls it the easiest way for most small networks. |
| Feasible | any route it knows to the source, not only the best, uses that interface | A customer with several links to you                                                             |
| Loose    | it has any route to the source at all                                    | Hardly anywhere. RFC 3704 recommends it only as a way to measure.                                |

<Quiz
  question="Your network checks the source of every packet from its customers, as BCP 38 asks. Who does that protect?"
  :choices="['Your own customers, from floods aimed at them', 'Everyone else on the internet, from floods launched from your network', 'Your router, from traffic to its CPU']"
  :answer="1"
  :why="['A flood aimed at your customers comes from other networks, which your check never sees.', '', 'The check looks at traffic through the router, from customers. Protecting the CPU is a different filter.']"
  explain="The check stops forged packets as they leave your customers, so nobody can use your network to reflect a flood at a victim elsewhere. You are protected when the other networks do the same."
/>

## Anti-spoofing in Circuit

Circuit has no field for uRPF. You write the same check as a list, in the router's switch chip, with an ACL on each customer port. The ACL accepts the customer's own space and its end of the link, and drops any other source.

```ts
interfaces: {
    ethernet: {
        "25g-3": { description: "Netflix", access_vlan: "netflix", ingress_acl: "from-netflix" },
    },
},
switching: {
    acls: {
        // Netflix may only send from its own space, and from its end of the link.
        "from-netflix": [
            { description: "Netflix's own IPv4", if: { src: "192.0.2.0/24" }, then: "accept" },
            { description: "Netflix's end of the link", if: { src: "198.51.100.252/30" }, then: "accept" },
            { description: "Any other IPv4 source", if: { family: "ipv4" }, then: "drop" },
        ],
    },
},
```

A FortiGate's ACLs can only drop. So on a FortiGate the same check goes in its firewall instead, as rules that accept the customer's sources on that port and drop the rest. Write the IPv6 rules the same way. Keep accepting link-local sources, `fe80::/10`, which IPv6 neighbor discovery uses on the link, as RFC 4861 says.

The other direction is an ACL on the ports toward your transits and exchanges. It drops traffic from the internet that claims to come from your own space or a private range. The [edge router example](/guide/examples#an-edge-router) filters both of its outside ports this way, with its ACL `edge`.

### Inside one subnet

The gateway's check stops sources outside a subnet. Inside it, any server can still send as its neighbor, with its address, its MAC address, or an answer to ARP in its name. The switch closes that gap at the port. `bound_to` lists the hosts on an access port, each with its MAC address and the addresses it sends from:

```ts
"10g-7": {
    description: "Customer server",
    access_vlan: "servers",
    bound_to: [
        { mac: "02:00:00:00:00:01", addresses: ["192.0.2.10", "2001:db8::10"] },
        // Its management card shares the cable, with a MAC address of its own.
        { mac: "02:00:00:00:00:02", addresses: ["192.0.2.11"] },
    ],
},
```

The port then takes IPv4 and IPv6 only from those MAC addresses with those sources, and ARP only from them. It also takes the sources every host sends from: `0.0.0.0` while it asks DHCP for an address, link-local IPv6, and `::`. It drops anything else.

A server whose virtual machines are bridged onto its cable lists each machine, so a new machine needs a new entry before it can send. A port with another switch behind it can't be bound host by host. The gateway's check is what protects it.

On Junos the switch can't read inside an ARP packet. So a bound host can still claim a neighbor's address in ARP, but it can no longer send packets from that address.

## Shedding a flood

On February 28, 2018, at 17:21 UTC, GitHub received a memcached reflection flood. It peaked at 1.35 Tbit/s and 126.9 million packets a second, more than GitHub's links to its transits could carry. At 17:26 GitHub withdrew its routes from its transits, and announced them only over its links to Akamai, a DDoS protection provider. So the flood went to Akamai's network instead. After the routes settled, access control lists stopped the attack. By 17:30 the site was back.

The lesson is about where the flood is dropped. A filter on your own router acts only after the flood has crossed your links from your upstreams. When those links are full, everyone behind them loses packets, not only the target. So the flood has to be dropped on the far side of those links.

**Remote triggered blackholing** is the tool every provider has for this. You announce the address under attack in BGP as a <Term means="A route for one single address: a /32 in IPv4, or a /128 in IPv6.">host route</Term>, a /32 or a /128, with a <Term means="A BGP community that asks the network receiving a route to drop all traffic to it. RFC 7999 reserves 65535:666 for it.">blackhole community</Term>. The network receiving it drops all traffic toward that address. RFC 7999 reserves `65535:666` for it, and asks the receiver to keep the route inside its own network. Each upstream chooses whether it takes blackholes. One that does gives you the community to use.

<TryIt title="Blackhole the target, and see who stops sending">

Send a wave of the flood as it is. Then have Netflix ask for a blackhole, and send again. Then add the blackhole communities, one at a time, and watch the link meters.

<BlackholeFlood />

</TryIt>

A blackhole on your own router freed Netflix's link, and nothing else. Each upstream that received the route freed your link to it. In every case `192.0.2.10` became unreachable for everyone. Blackholing gives up one address to save every other customer, as RFC 5635 says. Netflix can move its service to another address while the attack lasts.

In Circuit, blackholing is part of the [community scheme](/guide/communities). The scheme in `circuit.ts` says which community asks for a blackhole:

```ts
// circuit.ts
communities: {
    groups: { transit: { value: 1 }, exchange: { value: 2 }, customer: { value: 3 } },
    learned_from_group: { code: 1 },
    blackhole: { code: 666 },
},
```

Each upstream that takes blackholes carries its own community:

```ts
// edge-01.ts, the neighbors
// hurricane-electric drops traffic to a route it receives with 6939:666. cogent has no blackhole community here, so it never receives the route.
"hurricane-electric": { address: "203.0.113.1", remote_as: 6939, role: "provider", import_policy: "transit-import", export_policy: "export", communities: { groups: ["transit"], blackhole: "6939:666" } },
"cogent": { address: "203.0.113.129", remote_as: 174, role: "provider", import_policy: "transit-import", export_policy: "export", communities: { groups: ["transit"] } },
netflix: { address: "198.51.100.254", remote_as: 2906, role: "customer", import_policy: "netflix-import", export_policy: "netflix-export", communities: { groups: ["customer"] } },
```

The import from a customer allowed to ask for a blackhole says so with `accept_requests`:

```ts
// edge-01.ts, the first rule of Netflix's import: Netflix may ask for a blackhole. The rest of the import accepts only Netflix's own space, so it can never blackhole someone else.
{ communities: "import", accept_requests: ["blackhole"] },
```

Circuit writes the rest from the scheme. The communities rule in Netflix's import keeps the blackhole request. `{ communities: "export" }` in the export to hurricane-electric passes the route on with `6939:666`, and the export to cogent drops it.

Blackholing drops everything toward the address, the attack and the customers of that service alike. <Term means="BGP flow specification: rules carried in BGP that match traffic by addresses, protocol, ports, packet length, and more. A router then drops or limits only the traffic that matches.">Flowspec</Term>, defined in RFC 8955, is the finer tool. It is a rule carried in BGP that matches the flood by protocol, ports, or packet length, and drops or rate-limits only that. Circuit has no field for flowspec.

On your own edge, `presets.udp_amplifiers` lists the source ports of reflected floods, for a switch-chip rule that drops them. This saves your router, but not the link the flood arrived on.

<Quiz
  question="A flood of 30 Gbit/s toward one customer address arrives over your two 10 Gbit/s transit links. You blackhole the address on your own router only. What changes?"
  :choices="['Everything recovers, since the flood is dropped', 'The customer link is freed, but both transit links stay full', 'Nothing, since a blackhole only works upstream']"
  :answer="1"
  :why="['It is dropped after it has crossed your transit links, which it still fills, so every customer behind them still loses packets.', '', 'Your router does drop it, so the customer link is freed. The transit links are the part only an upstream can free.']"
  explain="Your router drops the flood, so it never reaches the customer link. But it still arrives over your transit links and fills them. Only an upstream that receives the blackhole route can free those."
/>

## Protecting the router itself

Some floods reach the router's CPU, the same CPU that runs BGP. A flood aimed at the router's own address does, and so does a flood of traffic the router must think about. If the CPU falls behind, sessions drop, and the whole network loses its routes. RFC 6192 gives the rule. Decide what traffic the router itself needs, such as BGP from its neighbors and management from your own networks. Then filter everything else that is addressed to it.

In Circuit, that is the input chain, with `default_action: "drop"`, as the [edge router example](/guide/examples#an-edge-router) writes it. Three more things help on RouterOS, all found on a real router:

- **Drop in the switch chip what you can recognize.** An ACL drop never reaches the CPU. A `rate` on a switch-chip rule didn't limit traffic the CPU routes, so drop instead of limiting.
- **Keep floods out of the <Term means="A router keeping a list of the connections passing through it, so it can tell a reply from a packet that starts a new connection. The list is called the connection table.">connection table</Term>.** The connection table of a CCR2216, the router the RouterOS adapter was tested on, has room for 1,048,576 entries. A full table refuses every new connection through the router, not only the target's. A <Term means="A flood of TCP SYN packets, the first packet of a connection, from addresses that never finish the handshake. The receiver keeps waiting on each one.">SYN flood</Term> of 210,000 packets a second filled it in five seconds. Traffic to and from prefixes in `untracked` never enters it.
- **Answer SYN floods with <Term means="A way to answer a TCP SYN without remembering it. The details go into the reply, and are checked only if the sender completes the handshake.">SYN cookies</Term>**, `system.ip_stack.syn_cookies`, so the router keeps no state for half-open connections to itself.

```ts
system: { ip_stack: { syn_cookies: true } },

firewall: {
    // Netflix's servers: a flood toward them never fills the connection table.
    untracked: ["192.0.2.0/24"],
    address_sets: { management: ["10.0.0.0/24"], "bgp-neighbors": bgpNeighbors() },
    filter: {
        input: {
            default_action: "drop",
            rules: [
                { description: "Replies", if: { connection_state: ["established", "related"] }, then: "accept" },
                { description: "Ping", if: { protocol: "icmp" }, then: "accept" },
                { description: "Management", if: { src_address_set: "management" }, then: "accept" },
                { description: "BGP", if: { src_address_set: "bgp-neighbors", protocol: "tcp", dst_port: presets.ports.bgp }, then: "accept" },
            ],
        },
        forward: { rules: presets.bad_tcp_flags },
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

- [RFC 2827](https://www.rfc-editor.org/rfc/rfc2827), network ingress filtering (BCP 38).
- [RFC 3704](https://www.rfc-editor.org/rfc/rfc3704), ingress filtering for networks with several upstreams (BCP 84): strict, feasible, and loose uRPF.
- [UDP-Based Amplification Attacks](https://www.cisa.gov/news-events/alerts/2014/01/17/udp-based-amplification-attacks), CISA: the amplification factors.
- [DDoS incident report](https://github.blog/2018-03-01-ddos-incident-report/), GitHub, on the attack of February 28, 2018.
- [RFC 5635](https://www.rfc-editor.org/rfc/rfc5635), remote triggered blackhole filtering with uRPF.
- [RFC 7999](https://www.rfc-editor.org/rfc/rfc7999), the BLACKHOLE community.
- [RFC 8955](https://www.rfc-editor.org/rfc/rfc8955), on flow specification rules.
- [RFC 6192](https://www.rfc-editor.org/rfc/rfc6192), on protecting the router control plane.
- [RFC 4861](https://www.rfc-editor.org/rfc/rfc4861), neighbor discovery for IPv6.
- [MANRS implementation guide for network operators](https://manrs.org/netops/guide/), on anti-spoofing.
