---
title: Separate networks on one
description: Give each customer a routing table of its own with VRFs, keep two customers with the same addresses apart, and see what MPLS and VXLAN carry.
---

# Separate networks on one

A provider carries many customers over the same routers, and each customer picks its own private addresses. Two of them will sooner or later both use `10.1.1.0/24`. A <Term means="Virtual routing and forwarding: a separate routing table on a router. Each port or interface belongs to one, and a packet arriving there is looked up only in that table.">VRF</Term> gives each customer a routing table of its own on the shared router. A packet is looked up only in the table of the port it arrived on, so the two `10.1.1.0/24` never meet.

Across a whole network, the provider also has to carry each customer's packets between its routers while remembering whose they are. That is what <Term means="Multiprotocol Label Switching: the provider's routers forward on short numbers, labels, put in front of a packet, instead of reading the packet's own address.">MPLS</Term> and <Term means="Virtual Extensible LAN: a customer's frame carried inside a UDP packet between two routers, with a number that says which customer it belongs to.">VXLAN</Term> do. Each wraps the customer's packet in an outer header that the core reads, with a number inside that says which customer it is.

## Two customers, the same addresses

A provider router facing customers is a <Term means="Provider edge: a router of the provider that customers connect to. It holds each customer's routes in that customer's VRF.">PE</Term>, provider edge. The customer's own router on the other end of the link is the <Term means="Customer edge: the customer's router on its side of the link to the provider.">CE</Term>, customer edge. In the [IP VPN](/academy/professional/private-circuits) product, the provider joins a customer's offices into one private network: office 1 reaches office 2 through the provider, by the private addresses the customer chose.

Below, one PE, `pe-01`, has two such customers. Each has two offices, and both numbered them the same way, because both started from the same private ranges you met in [NAT](/academy/elementary/nat).

<TryIt title="Keep two customers apart">

Send a packet to 10.1.2.20 from each customer while pe-01 has one routing table. Then give each customer a VRF and send again. Watch which table row the router uses.

<VrfSplit />

</TryIt>

With one table, the router holds two routes to `10.1.2.0/24`, one for each customer. They have the same prefix and the same length, so the longest match cannot choose between them. A router uses one of them, or shares traffic between both, depending on the router; either way, some of one customer's traffic is delivered into the other customer's network. Here `circuit validate` stops the file before it reaches the router, but only because the two customers' links also share addresses: `172.16.0.1 is on both port 25g-1 and port 25g-3`. Two routes to one prefix alone are a normal thing to write, as a backup for each other, and Circuit cannot know they belong to two customers.

With a VRF each, the port says which table to use. A packet from Customer B's office arrives on a port in VRF `cust-b`, and Customer A's `10.1.2.0/24` is in a table that packet never sees. The customers are kept apart by the router itself, not by a filter someone could forget.

<Quiz
  question="Customer A and Customer B both use 10.20.0.0/16. On pe-01, each has its own VRF. Customer A sends a packet to 10.20.5.5. Where can it go?"
  :choices="['Only to Customer A, through a route in VRF cust-a', 'To whichever customer pe-01 learned 10.20.0.0/16 from first', 'To both customers, as a copy each']"
  :answer="0"
  :why="['', 'That is what happens in one shared table. With VRFs, the packet is looked up only in the table of the port it came in on.', 'A router forwards a packet to one place. VRFs decide which table it is looked up in, not how many copies are made.']"
  explain="The port Customer A's packet arrives on is in VRF cust-a, so pe-01 looks only there. Customer B's 10.20.0.0/16 is in another table, and this packet cannot reach it."
/>

## VRFs in Circuit

A VRF is `vrfs` in the device file, and each port, interface or static route says which VRF it is in with `vrf`. This is `pe-01` from the widget, with a VRF for each customer. Both customers' links use the same addresses, just as their offices do, and that is fine: each `172.16.0.1` is in a different table.

```ts
vrfs: {
    "cust-a": { description: "Customer A" },
    "cust-b": { description: "Customer B" },
},

ports: {
    "25g-1": { description: "Customer A, office 1", addresses: ["172.16.0.1/30"], vrf: "cust-a" },
    "25g-2": { description: "Customer A, office 2", addresses: ["172.16.0.5/30"], vrf: "cust-a" },
    "25g-3": { description: "Customer B, office 1", addresses: ["172.16.0.1/30"], vrf: "cust-b" },
    "25g-4": { description: "Customer B, office 2", addresses: ["172.16.0.5/30"], vrf: "cust-b" },
},

routing: {
    static: [
        { prefix: "10.1.1.0/24", via: "172.16.0.2", vrf: "cust-a", description: "Customer A, office 1" },
        { prefix: "10.1.2.0/24", via: "172.16.0.6", vrf: "cust-a", description: "Customer A, office 2" },
        { prefix: "10.1.1.0/24", via: "172.16.0.2", vrf: "cust-b", description: "Customer B, office 1" },
        { prefix: "10.1.2.0/24", via: "172.16.0.6", vrf: "cust-b", description: "Customer B, office 2" },
    ],
},
```

| Field            | What it does                                                                        |
| ---------------- | ----------------------------------------------------------------------------------- |
| `vrfs`           | The device's VRFs, each under a name, with an optional `description`.               |
| `vrf` on a port  | The table this port routes in. A port without `vrf` routes in the default table.    |
| `vrf` on a route | The table a static route belongs to. Without it, the route is in the default table. |

A name that is not in `vrfs` is an error before anything reaches the router: `static route 10.1.2.0/24 VRF 'cust-c' is not declared`.

The same idea keeps a network's own management apart. In [`examples/full-setup/`](https://github.com/takodotid/circuit/tree/main/examples/full-setup), each edge router has a VRF called `oob` for its out-of-band port, with a default route of its own, so the operators' way in never mixes with customer or internet traffic.

Of the platforms Circuit supports, `routeros` runs VRFs, `vrp` runs them for IPv4, and `raisecom-ros` reports `vrfs` as an error; see [Platforms](/platforms/). Circuit has no field for running BGP inside a VRF, or for passing routes from one VRF to another, so routes in a VRF are static ones you write.

## Carrying a customer across the core

One PE is the easy case. A provider has PEs in many places, and between them the core: routers that join PEs to each other and face no customer, called <Term means="Provider routers: the provider's core routers between PEs. They face no customer and hold none of the customers' routes.">P routers</Term>. If every P router held every customer's VRF, the core would need thousands of tables, and would have to change whenever a customer did.

So the PE wraps the customer's packet. The core reads only the wrapping, which says "from this PE to that PE". The network the core routes is called the <Term means="The provider's own network that the wrapped packets cross: its links, its routers and the addresses of its PEs.">underlay</Term>; the customers' networks carried across it are the <Term means="A network carried inside another: the customers' separate networks, wrapped and sent across the provider's underlay.">overlay</Term>. Two ways of wrapping are in wide use.

1. **MPLS**. The PE puts short numbers, <Term means="A 4-byte number put in front of a packet. A router on an MPLS network forwards by the label, and swaps it for the next router's.">labels</Term>, in front of the packet. In a BGP/MPLS IP VPN, or **L3VPN**, defined in RFC 4364, there are two: an outer label that leads to the far PE, and an inner one that the far PE gave out for that customer's VRF. PEs tell each other customers' routes over iBGP (see [BGP inside a network](/academy/professional/ibgp-at-scale)). A <Term means="Route distinguisher: 8 bytes put in front of a customer's prefix inside BGP, so two customers' identical prefixes stay two different routes.">route distinguisher</Term> keeps two customers' identical prefixes apart inside BGP, and a <Term means="Route target: a tag on a VPN route that says which VRFs on other PEs take it in.">route target</Term> says which VRFs take a route in.
2. **VXLAN**, defined in RFC 7348. The PE puts the customer's Ethernet frame inside a UDP packet to port 4789, addressed to the far end. A <Term means="VXLAN network identifier: the 24-bit number in a VXLAN header that says which customer or segment a frame belongs to.">VNI</Term> in the VXLAN header says which segment the frame is from. A VNI has 24 bits, about 16 million segments, against the 4094 of a VLAN ID. Each tunnel end is a <Term means="VXLAN tunnel end point: a router or switch that wraps frames into VXLAN and unwraps them.">VTEP</Term>.

Both still leave a question: how does a PE learn which customer addresses are behind which other PE? Plain VXLAN learns by flooding: it sends unknown traffic to every other VTEP and remembers where the answers come from. <Term means="Ethernet VPN: the PEs announce in BGP which customer MAC and IP addresses are behind each of them, so nobody has to flood to find out.">EVPN</Term>, defined in RFC 7432 for MPLS and RFC 8365 for VXLAN, has the PEs announce it in BGP instead. RFC 7348 made VXLAN for data centres, where it carries segments between the switches of a [leaf-spine](/academy/professional/device-roles) fabric.

<TryIt title="Wrap a packet and send it across the core">

Step through Customer A's packet with VXLAN, then with MPLS labels. At each router, see which header it reads. Then send Customer B's packet, to the same address, and see what changes. Then, with the customer sending 1500-byte packets, find the size the core links must carry.

<OverlayWrap />

</TryIt>

The core router in the middle read only the outer IP header, or the outer label, the same for both customers. Only the VNI, or the inner label, told the two packets apart, and only pe-02 read it. The core does not know Customer A exists, which is the whole point: the core stays the same size however many customers there are, and only the PEs hold VRFs.

The wrapping has a cost in bytes. VXLAN adds 50: an inner Ethernet header of 14, then 8 for VXLAN, 8 for UDP and 20 for the outer IPv4 header. Each MPLS label adds 4. A customer sending full 1500-byte packets therefore needs core links whose <Term means="Maximum transmission unit: the largest packet a link carries in one piece. A Circuit port without `mtu` takes 1500 bytes.">MTU</Term>, maximum transmission unit, is at least 1550 bytes for VXLAN, and RFC 7348 says a tunnel end must not split a VXLAN packet into pieces. The fix is to raise the MTU of the core links well above 1500, to a <Term means="A frame larger than the usual 1500 bytes of IP, such as 9000. The links inside a core are set to it so wrapped packets still fit.">jumbo frame</Term> size, as the core link in the next section does with `mtu: 9000`. Where a tunnel crosses the internet, whose links you do not control, the tunnel's own MTU is lowered instead, as the `vxlan-b1` tunnel in `examples/full-setup/` does with `mtu: 1450`.

<Quiz
  question="A P router in the middle of an MPLS core forwards a Customer A packet from pe-01 to pe-02. What does it need to know?"
  :choices="['Customer A routes, in a VRF of its own', 'Only the outer label, which leads to pe-02', 'The customer packet destination address']"
  :answer="1"
  :why="['That is the job of the PEs. A P router holds no VRF and no customer route.', '', 'It never looks that deep. Only pe-01 and pe-02 read the customer packet itself.']"
  explain="The outer label leads to pe-02, so that is all a P router reads. Only the PEs at each end hold VRFs and read the customer's own addresses."
/>

<Quiz
  question="Your core links carry 1500-byte packets. A customer sends 1500-byte packets over VXLAN between two PEs. What happens?"
  :choices="['They arrive, since the customer sends exactly 1500', 'They do not fit: VXLAN adds 50 bytes, and a VTEP must not split them', 'The core router removes the VXLAN header to make them fit']"
  :answer="1"
  :why="['The customer sends 1500, but the core must carry the wrapping too: 1550 bytes in all.', '', 'Only the far VTEP removes the wrapping. The core router in between reads the outer header and forwards the packet as it is.']"
  explain="1500 bytes of packet plus 50 bytes of wrapping is 1550, larger than the core links take. Raise the core MTU, or lower the MTU on the tunnel so the customer sends smaller packets."
/>

## Overlays in Circuit

Circuit writes a VXLAN tunnel as an interface of `type: "vxlan"`: its two ends, `local` and `remote`, its `vni`, and optionally its UDP `port`, 4789 when absent. Like any interface, it can hold addresses and sit in a VRF. Each customer gets a tunnel of its own from `pe-01` to `pe-02`, between the same two loopbacks, told apart by its VNI:

```ts
ports: {
    "100g-1": { description: "Core, to pe-02", mtu: 9000, addresses: ["10.255.0.0/31"], link: { device: "pe-02", port: "100g-1" } },
},

interfaces: {
    loopback: { type: "loopback", addresses: ["192.0.2.1/32"] },
    "vxlan-a": {
        type: "vxlan",
        description: "Customer A, to pe-02",
        vni: 10001,
        local: "192.0.2.1",
        remote: "192.0.2.2",
        vrf: "cust-a",
        addresses: ["172.16.9.0/31"],
    },
    "vxlan-b": {
        type: "vxlan",
        description: "Customer B, to pe-02",
        vni: 10002,
        local: "192.0.2.1",
        remote: "192.0.2.2",
        vrf: "cust-b",
        addresses: ["172.16.9.0/31"],
    },
},

routing: {
    static: [
        { prefix: "192.0.2.2/32", via: "10.255.0.1", description: "pe-02's loopback" },
        { prefix: "10.1.2.0/24", via: "172.16.9.1", vrf: "cust-a", description: "Customer A, office 2, at pe-02" },
        { prefix: "10.1.2.0/24", via: "172.16.9.1", vrf: "cust-b", description: "Customer B, office 2, at pe-02" },
    ],
},
```

`pe-02` holds the same two tunnels the other way round. When both routers are in your network, `circuit validate` checks that each tunnel has one back at the far end, with the ends swapped and the same VNI and port.

Circuit does not do the rest of this lesson, and it is better to know that now:

- **No MPLS**: no labels, no L3VPN, no route distinguishers or route targets.
- **No EVPN**: each VXLAN tunnel is point to point, with its far end written by hand, and the routes through it are static.
- **No BGP inside a VRF.**

For a few sites, tunnels and static routes written in files are easy to read and to review. For a provider with hundreds of customers, PEs that announce routes to each other with MPLS or EVPN do the work that hand-written tunnels cannot, on platforms that run them, outside Circuit today.

## Further reading

- [RFC 4364, BGP/MPLS IP Virtual Private Networks](https://www.rfc-editor.org/rfc/rfc4364): VRFs, PE, CE and P routers, route distinguishers and route targets.
- [RFC 3032, MPLS Label Stack Encoding](https://www.rfc-editor.org/rfc/rfc3032): a label is 4 bytes.
- [RFC 7348, Virtual eXtensible Local Area Network (VXLAN)](https://www.rfc-editor.org/rfc/rfc7348): the 24-bit VNI, UDP port 4789, and why a VTEP must not fragment.
- [RFC 7432, BGP MPLS-Based Ethernet VPN](https://www.rfc-editor.org/rfc/rfc7432): EVPN.
- [RFC 8365, A Network Virtualization Overlay Solution Using EVPN](https://www.rfc-editor.org/rfc/rfc8365): EVPN for VXLAN.

## In short

- A VRF is a routing table of its own on a shared router. A packet is looked up only in the VRF of the port it arrived on, so customers with the same addresses stay apart.
- In Circuit, `vrfs` declares them, and `vrf` on a port, interface or static route puts it in one.
- Across a network, PEs wrap customer packets so the core reads only the outer header: MPLS with labels, as in an L3VPN, or VXLAN inside UDP, with a VNI for each segment. EVPN announces in BGP what sits behind each PE.
- Wrapping adds bytes: 50 for VXLAN, 4 per MPLS label. The core's MTU must make room, or the tunnel's must shrink.
- Circuit writes point-to-point VXLAN tunnels and static routes in VRFs. It has no MPLS, no EVPN and no BGP inside a VRF.
