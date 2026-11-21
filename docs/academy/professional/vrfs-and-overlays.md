---
title: Separate networks on one
description: Give each customer a routing table of its own with VRFs, keep two customers with the same addresses apart, and see what MPLS and VXLAN carry.
---

# Separate networks on one

A provider carries many customers over the same routers, and each customer picks its own private addresses. Sooner or later, two of them both use `10.1.1.0/24`. A <Term means="Virtual routing and forwarding: a separate routing table on one router. Each interface belongs to one VRF, and a packet arriving there is looked up only in that table.">VRF</Term> gives each customer a routing table of its own on the shared router. A packet is looked up only in the table of the port it arrived on, so the two `10.1.1.0/24` never meet.

## Two customers, the same addresses

A provider router facing customers is a <Term means="Provider edge: a router of the provider that customers connect to. It keeps each customer's routes in that customer's VRF.">PE</Term>, provider edge. The customer's own router on the other end of the link is the <Term means="Customer edge: the customer's router on its side of the link to the provider.">CE</Term>, customer edge. With an [IP VPN](/academy/professional/private-circuits), the provider joins a customer's offices into one private network. Office 1 reaches office 2 through the provider, by the private addresses the customer chose.

Here one PE, `pe-01`, has two such customers: a bank and a school. Each has two offices, and both numbered them the same way, from the private ranges in [NAT](/academy/elementary/nat).

<TryIt title="Keep two customers apart">

<VrfSplit />

</TryIt>

With one table, the two customers' routes to `10.1.2.0/24` have the same prefix and length, so the longest match can't choose between them. Depending on the router, it uses one of them, or shares traffic between both. Either way, some of one customer's traffic is delivered into the other customer's network.

Here `circuit validate` stops the file, but only because the two customers' links also share addresses. Two routes to one prefix alone are a normal thing to write, as a backup for each other, and Circuit can't know they belong to two customers.

With a VRF each, the router itself keeps the customers apart, not a filter someone could forget.

<Quiz
  question="The bank and the school both use 10.20.0.0/16. On pe-01, each has its own VRF. The bank sends a packet to 10.20.5.5. Where can it go?"
  :choices="['Only to the bank, through a route in VRF bank', 'To whichever customer pe-01 learned 10.20.0.0/16 from first', 'To both customers, as a copy each']"
  :answer="0"
  :why="['', 'That is what happens in one shared table. With VRFs, the packet is looked up only in the table of the port it came in on.', 'A router forwards a packet to one place. VRFs decide which table it is looked up in, not how many copies are made.']"
  explain="The port the packet of the bank arrives on is in VRF bank, so pe-01 looks only there. The 10.20.0.0/16 of the school is in another table, and this packet cannot reach it."
/>

## VRFs in Circuit

This is `pe-01` from the widget, with a VRF for each customer. Both customers' links use the same addresses, just as their offices do. That is fine, because each `172.16.0.1` is in a different table.

```ts
interfaces: {
    ethernet: {
        "25g-1": { description: "Bank, office 1", addresses: ["172.16.0.1/30"], vrf: "bank" },
        "25g-2": { description: "Bank, office 2", addresses: ["172.16.0.5/30"], vrf: "bank" },
        "25g-3": { description: "School, office 1", addresses: ["172.16.0.1/30"], vrf: "school" },
        "25g-4": { description: "School, office 2", addresses: ["172.16.0.5/30"], vrf: "school" },
    },
},

routing: {
    // One routing table for each customer.
    vrfs: {
        bank: {},
        school: {},
    },
    static_routes: [
        // The bank's offices, then the school's: the same prefixes, in different tables.
        { prefix: "10.1.1.0/24", next_hop: "172.16.0.2", vrf: "bank" },
        { prefix: "10.1.2.0/24", next_hop: "172.16.0.6", vrf: "bank" },
        { prefix: "10.1.1.0/24", next_hop: "172.16.0.2", vrf: "school" },
        { prefix: "10.1.2.0/24", next_hop: "172.16.0.6", vrf: "school" },
    ],
},
```

| Field                        | What it does                                                                   |
| ---------------------------- | ------------------------------------------------------------------------------ |
| `vrfs`                       | The device's VRFs, each under a name, with an optional `description`.          |
| `vrf` on a port or interface | The table it routes in. Without `vrf`, it routes in the default table.         |
| `vrf` on a route             | The table a static route is in. Without it, the route is in the default table. |

A name that isn't in `vrfs` is an error before anything reaches the router:

```text
pe-01: routing.static_routes[3].vrf: no VRF shop
```

The same idea keeps a network's own management apart. Give each edge router a VRF such as `oob` for its out-of-band port, with a default route of its own. Then the operators' way in never mixes with customer or internet traffic.

Most platforms run VRFs, but Raisecom ROS doesn't, and some platforms have limits. [Platforms](/reference/platforms) lists them. A VRF can also learn its routes: a BGP neighbor or OSPF with `vrf` runs in it, and `routing.vrf_imports` takes routes from one VRF into another through a policy.

## Carrying a customer across the core

One PE is the easy case. A provider has PEs in many places, with the core between them. The core is routers that join PEs to each other and face no customer, called <Term means="Provider router: a core router of the provider, between the PE routers. It faces no customer, and has none of the customers' routes.">P routers</Term>. If every P router had every customer's VRF, the core would need thousands of tables. It would also have to change whenever a customer did.

So the PE wraps the customer's packet. The core reads only the wrapping, which says "from this PE to that PE." The network the core routes is called the <Term means="The network that carries an overlay's wrapped packets: the provider's own links, routers, and addresses.">underlay</Term>. The customers' networks carried across it are the <Term means="A network carried inside another network, such as customers' networks wrapped and sent across a provider's own network, the underlay.">overlay</Term>. Two ways of wrapping are in wide use:

1. **<Term means="Multiprotocol Label Switching: routers forward each packet by a short label put in front of it, instead of by the packet's own address.">MPLS</Term>**. The PE puts short numbers, <Term means="A short number put in front of a packet on an MPLS network. Each router forwards by the label, and swaps it for the label the next router expects.">labels</Term>, in front of the packet. A BGP/MPLS IP VPN, or **L3VPN**, is defined in RFC 4364. It uses two labels: an outer label that leads to the far PE, and an inner one that the far PE gave out for that customer's VRF. PEs tell each other the customers' routes over iBGP, as in [BGP inside a network](/academy/professional/ibgp-at-scale). A <Term means="Eight bytes put in front of a customer's prefix inside BGP, so two customers' identical prefixes stay two different routes.">route distinguisher</Term> keeps two customers' identical prefixes apart inside BGP. A <Term means="A tag on a VPN route that says which VRFs on other PE routers take it in.">route target</Term> says which VRFs take a route in.
2. **<Term means="Virtual Extensible LAN: a frame carried inside a UDP packet between two routers or switches, with a number that says which network it belongs to.">VXLAN</Term>**, defined in RFC 7348. The PE puts the customer's Ethernet frame inside a UDP packet to port 4789, addressed to the far end. A <Term means="VXLAN network identifier: the 24-bit number in a VXLAN header that says which customer or segment a frame belongs to.">VNI</Term> in the VXLAN header says which segment the frame is from. A VNI has 24 bits, for about 16 million segments, where a VLAN ID has 4094. Each tunnel end is a <Term means="VXLAN tunnel endpoint: a router or switch that wraps frames in VXLAN and unwraps them.">VTEP</Term>.

Both still leave a question: how does a PE learn which customer addresses are behind which other PE? Plain VXLAN learns by flooding. It sends unknown traffic to every other VTEP, and remembers where the answers come from. With <Term means="Ethernet VPN: routers announce in BGP which MAC and IP addresses are behind each of them, so nobody has to flood to find out.">EVPN</Term>, the PEs announce it in BGP instead. RFC 7432 defines EVPN for MPLS, and RFC 8365 for VXLAN. RFC 7348 made VXLAN for data centers, where it carries segments between the switches of a [leaf-spine](/academy/professional/device-roles) fabric.

<TryIt title="Wrap a packet and send it across the core">

Step through the bank's packet with VXLAN, then with MPLS labels. Then send the school's packet to the same address, and see what changes. Last, find the MTU the core links need for 1500-byte packets.

<OverlayWrap />

</TryIt>

Only the VNI, or the inner label, told the two packets apart, and only `pe-02` read it. So the core stays the same size however many customers there are, and only the PEs have VRFs.

The wrapping costs bytes. VXLAN adds 50, and each MPLS label adds 4. So for a customer sending full 1,500-byte packets, the core links need an <Term means="Maximum transmission unit: the largest single piece of data a link carries, in bytes. On ordinary Ethernet it is 1,500 bytes.">MTU</Term> of at least 1,550 bytes for VXLAN. RFC 7348 says a tunnel end must not split a VXLAN packet into pieces.

So raise the MTU of the core links well over 1,500, to a <Term means="A frame that carries more than the usual 1,500 bytes, often about 9,000. Networks use jumbo frames on links between their own devices, such as inside a data center.">jumbo frame</Term> size. The core link in the next section does this with `mtu: 9000`. Where a tunnel crosses the internet, whose links you don't control, lower the tunnel's own MTU instead.

<Quiz
  question="A P router in the middle of an MPLS core forwards a packet of the bank from pe-01 to pe-02. What does it need to know?"
  :choices="['The routes of the bank, in a VRF of its own', 'Only the outer label, which leads to pe-02', 'The destination address in the customer packet']"
  :answer="1"
  :why="['That is the job of the PEs. A P router has no VRF and no customer route.', '', 'It never looks that deep. Only pe-01 and pe-02 read the customer packet itself.']"
  explain="The outer label leads to pe-02, so that is all a P router reads. Only the PEs at each end have VRFs and read the customer's own addresses."
/>

<Quiz
  question="Your core links carry 1500-byte packets. A customer sends 1500-byte packets over VXLAN between two PEs. What happens?"
  :choices="['They arrive, since the customer sends exactly 1500', 'They do not fit: VXLAN adds 50 bytes, and a VTEP must not split them', 'The core router removes the VXLAN header to make them fit']"
  :answer="1"
  :why="['The customer sends 1500, but the core must carry the wrapping too: 1550 bytes in all.', '', 'Only the far VTEP removes the wrapping. The core router in between reads the outer header and forwards the packet as it is.']"
  explain="1500 bytes of packet plus 50 bytes of wrapping is 1550, larger than the core links take. Raise the core MTU, or lower the MTU on the tunnel so the customer sends smaller packets."
/>

## Overlays in Circuit

Circuit writes a VXLAN tunnel under `interfaces.vxlan`. Each tunnel has its two ends, `local_address` and `remote_address`, its `vni`, and its UDP `port`, which is 4789 when you leave it out. Like any interface, it can have addresses and be in a VRF. Each customer gets a tunnel of its own from `pe-01` to `pe-02`, between the same two loopbacks, told apart by its VNI:

```ts
interfaces: {
    ethernet: {
        "100g-1": { description: "pe-02 qsfp28-1-1", mtu: 9000, addresses: ["10.255.0.0/31"], link: { device: "pe-02", port: "100g-1" } },
    },
    loopback: {
        loopback: { addresses: ["192.0.2.1/32"] },
    },
    vxlan: {
        "vxlan-bank": {
            description: "Bank, to pe-02",
            vni: 10001,
            local_address: "192.0.2.1",
            remote_address: "192.0.2.2",
            vrf: "bank",
            addresses: ["172.16.9.0/31"],
        },
        "vxlan-school": {
            description: "School, to pe-02",
            vni: 10002,
            local_address: "192.0.2.1",
            remote_address: "192.0.2.2",
            vrf: "school",
            addresses: ["172.16.9.0/31"],
        },
    },
},

routing: {
    vrfs: { bank: {}, school: {} },
    static_routes: [
        { prefix: "192.0.2.2/32", next_hop: "10.255.0.1", description: "pe-02's loopback" },
        { prefix: "10.1.2.0/24", next_hop: "172.16.9.1", vrf: "bank", description: "Bank, office 2, at pe-02" },
        { prefix: "10.1.2.0/24", next_hop: "172.16.9.1", vrf: "school", description: "School, office 2, at pe-02" },
    ],
},
```

`pe-02` has the same two tunnels the other way round. When both routers are in your network, `circuit validate` checks that each tunnel has one back at the far end. The ends must be swapped, and the VNI and port must match.

Tunnels and static routes written in files suit a few sites. A provider with hundreds of customers needs PEs that announce the customers' routes to each other.

## L3VPN in Circuit

With MPLS in the core, the PEs announce each VRF's routes to each other over iBGP, as an L3VPN. Each VRF gets a route distinguisher and route targets, and one iBGP session between the two loopbacks carries the routes of every VRF. This is `pe-01` again, without the VXLAN tunnels:

```ts
// pe-01.ts, in routing
vrfs: {
    bank: { route_distinguisher: "64500:101", route_targets: { import: ["64500:101"], export: ["64500:101"] } },
    school: { route_distinguisher: "64500:102", route_targets: { import: ["64500:102"], export: ["64500:102"] } },
},
bgp: {
    neighbors: {
        "pe-02": { address: "192.0.2.2", remote_as: 64500, local_address: "192.0.2.1", address_families: ["vpnv4"] },
    },
},
```

| Field                         | What it does                                                                                  |
| ----------------------------- | --------------------------------------------------------------------------------------------- |
| `route_distinguisher`         | Keeps this VRF's routes apart from another VRF's with the same prefix, inside BGP.            |
| `route_targets.export`        | The tags on every route this VRF holds, when it goes to the other PEs.                        |
| `route_targets.import`        | The VRF takes each route that comes with one of these tags.                                   |
| `vpnv4` in `address_families` | The session carries the VRFs' IPv4 routes. It runs between the loopbacks, inside your own AS. |

`pe-02` writes the same two VRFs with the same route targets. Now office 2 of the bank, at `pe-02`, learns the network of office 1 with no static route for it at `pe-02`. The school's routes carry another tag, so they stay in the school's VRF. A new customer is a new VRF on the PEs it uses, and the P routers in between don't change.

A VRF can also take only some of the routes with its tag, or send only some of its own. `import_policy` and `export_policy` name a route policy for each, as a BGP neighbor's do: the bank's VRF could send its offices' networks, and keep the link to its router to itself.

The core needs MPLS for this, which `routing.mpls` runs with LDP. The [MPLS core example](/guide/examples#an-mpls-core) has it all, on two RouterOS routers. On other platforms, Circuit doesn't write an L3VPN yet: [Platforms](/reference/platforms) says which.

## Ethernet across the core

Some customers want a cable between two sites, not routing: one Ethernet segment, as an [EPL](/academy/professional/private-circuits) gives. Over MPLS, the PE puts each frame from the customer's port into a <Term means="A path across an MPLS core between two PE routers that carries a customer's Ethernet frames, set up by LDP with a number both ends agree on.">pseudowire</Term> to the far PE. The far PE takes the frame out, and sends it on as it arrived. LDP sets up the pseudowire between the two loopbacks.

In Circuit, a pseudowire is a port of the PE in a VLAN, under `interfaces.pseudowire`. Put the customer's port in the same VLAN, and the customer's two sites are joined:

```ts
// pe-01.ts, in interfaces
ethernet: {
    "25g-5": { description: "Clinic, site 1", access_vlan: "clinic" },
},
pseudowire: {
    "pw-clinic": { description: "Clinic, to site 2 at pe-02", peer: "192.0.2.2", pw_id: 201, access_vlan: "clinic" },
},
```

`pe-02` writes one back, with `peer: "192.0.2.1"` and the same `pw_id`. LDP finds its neighbors on its links, and sets up a session to each pseudowire's far PE by itself, even across the core. For a session with another router that isn't a neighbor, list its loopback in `routing.mpls.ldp.targets`, at both ends: a targeted session. The two PEs also tell each other the largest frame the pseudowire carries, its `mtu`, and both must say the same. One pseudowire between two sites is called a VPWS. Several in one VLAN, one to each other PE, join many sites into one LAN, a VPLS. There, a frame that arrives over one pseudowire never leaves over another, so the PEs make no loop.

Circuit doesn't do the rest of this lesson: **no EVPN.** Each VXLAN tunnel is point to point, with its far end written by hand, and the routes through it are static.

## Further reading

- [RFC 4364](https://www.rfc-editor.org/rfc/rfc4364), BGP/MPLS IP virtual private networks: VRFs, the PE, CE, and P routers, route distinguishers, and route targets.
- [RFC 3032](https://www.rfc-editor.org/rfc/rfc3032), MPLS label stack encoding: a label is 4 bytes.
- [RFC 7348](https://www.rfc-editor.org/rfc/rfc7348), VXLAN: the 24-bit VNI, UDP port 4789, and why a VTEP must not fragment.
- [RFC 7432](https://www.rfc-editor.org/rfc/rfc7432), on EVPN over MPLS.
- [RFC 8365](https://www.rfc-editor.org/rfc/rfc8365), on EVPN for VXLAN.
