---
title: Choosing a device
description: Pick a router or switch for a role from the routes it must hold and the packets it must forward, then pick the optic and fibre for each link.
---

# Choosing a device

Pick a device by what its role asks of it: how many routes it must hold, how many packets a second it must forward, what it does to each packet, and which ports it needs. Those answers decide whether it forwards in a chip or on a CPU, and how big a table that chip must hold. Then pick an optic for each port, matched to the far end and to the fibre between them.

## Two ways to forward a packet

Every router has a CPU that runs its software: the routing protocols, the logins, the configuration. That part is called the <Term means="The part of a router that decides: it runs BGP and OSPF, builds the routing table and takes logins. It runs on the CPU.">control plane</Term>. Moving each packet from one port to another is the <Term means="The part of a router that moves packets from port to port, by looking up each one in the forwarding table. It runs on the CPU or in a chip.">data plane</Term>, and a device does it in one of two places.

**On the CPU.** Each packet is handled by software. Anything the software can do, it can do to the packet: track connections for a stateful firewall or NAT, rewrite it, count it. The routes it looks up live in the router's main memory, so the table can be very large. The cost is speed: the CPU does work for every packet, so its limit is in packets per second, and that limit drops as you ask more of each packet.

**In a chip.** A switch or router can have a chip built only to forward packets, an <Term means="Application-specific integrated circuit: a chip built for one job. In a switch or router, the job is looking up and forwarding packets at the full speed of its ports.">ASIC</Term>, often called the switching chip. It looks up and forwards packets at the full speed of all its ports at once, which is called <Term means="Forwarding as fast as the ports can carry, even with the smallest packets on every port at once. Also called line rate.">wire speed</Term>. The chip can only do what it was built for, and its table of routes lives in a small, fast memory of fixed size, often a <Term means="Ternary content-addressable memory: fast memory in a chip that finds the matching entry for an address in one step. It is costly, so there is little of it.">TCAM</Term>.

The table a router builds from everything it has learned is the <Term means="Routing information base: every route the router knows, from BGP, OSPF and static routes, with all their attributes. It lives in the router's main memory.">RIB</Term>. The table the data plane looks packets up in, only the best route for each prefix, is the <Term means="Forwarding information base: the best route for each prefix, copied from the RIB to wherever packets are forwarded, the chip or the CPU.">FIB</Term>. On a router that forwards in a chip, the FIB is copied into the chip, and the chip's memory is what limits it.

Many devices have both. The CCR2216, the router the Circuit examples use, has a CPU and a switching chip. Its maker's documentation says that routing in the chip is what reaches wire speed, that traffic routed in the chip does not pass the CPU's firewall, and that the chip holds up to 120,000 IPv4 routes and 20,000 IPv6 routes. In Circuit, `hardware_offload` chooses where a device forwards:

```ts
hardware_offload: true,
// ...
interfaces: {
    ix: {
        type: "vlan",
        vlan: "ix",
        addresses: ["203.0.113.140/25", "2001:db8:ffff::140/64"],
        hardware_offload: false,
    },
},
```

That is `edge-a1` in the full-setup example: the router forwards in its chip, but traffic through the exchange interface goes to the CPU, which the schema notes is what makes the firewall apply to it. On RouterOS, Circuit renders the first line as `set switch1 l3-hw-offloading=yes`.

## How many routes it must hold

An edge router that takes the <Term means="Every route on the internet, as a transit provider sends it: a route to every prefix that anyone announces.">full table</Term> from a transit provider holds a route to every prefix on the internet. At the start of 2026 that was about 1,050,000 IPv4 routes and about 242,000 IPv6 routes, and both grow every year. A router that holds the full table needs no default route; the part of the internet where routers work that way is called the <Term means="Default-free zone: the routers of the internet that hold a route to every prefix and need no default route.">default-free zone</Term>.

In a CPU's main memory, that is not what limits a router. In a chip, it is. In August 2014, the IPv4 table passed 512,000 routes, and some switches and routers in wide use had room for 512,000 IPv4 routes in their chip by default. On those, the routes past the limit were forwarded by the CPU, slowly and with a heavy load on it, until the chip's memory was divided differently and the device restarted. The fix took space from IPv6; the chip itself could not grow.

The lesson for choosing: read the FIB size on the datasheet for IPv4 and IPv6 apart, compare it with the full table today, and leave room for years of growth. As Geoff Huston of APNIC puts it, the size of that memory is what you buy when you buy the router.

Not every router needs the full table. A rack switch needs a default route and the site's own prefixes. An edge router can take only a default route from a transit, or a default and the routes it cares about, and then a much smaller chip will do. The full table is for the routers that choose between several ways out.

<Quiz
  question="A router forwards in a chip that holds 120,000 IPv4 routes. You connect it to a transit provider that sends the full table. What happens?"
  :choices="['The session refuses the extra routes', 'The routes that do not fit in the chip are forwarded some other way, usually by the CPU, and slowly', 'Nothing: the chip compresses the table']"
  :answer="1"
  :why="['BGP accepts what your import policy accepts. It knows nothing about the size of the chip, unless you set max_prefixes.', '', 'The chip holds what it holds. A full table of over a million routes is far more than 120,000.']"
  explain="BGP puts every route in the RIB, but only 120,000 fit in the chip. The CCR2216 offloads the longer prefixes and leaves the rest to its CPU, the same thing that happened to routers in 2014 when the table passed 512,000."
/>

## Packets a second, not only bits a second

A port's speed is in bits a second, but the work a router does is per packet. Ethernet sends each frame with 20 more bytes on the wire, a preamble before it and a gap after it, and the smallest frame is 64 bytes. So the most packets a 10 Gbit/s port can carry is:

```text
10,000,000,000 bits / ((64 + 20) bytes x 8 bits) = 14,880,952 packets a second
```

With full 1,518-byte frames, the same port carries about 812,000 packets a second. A CPU router that keeps up with 10 Gbit/s of large downloads may fall far short with 10 Gbit/s of small packets, which carry eighteen times as many. When a datasheet gives a forwarding rate, check the packet size it was measured at.

## x86 routers and licences

A router can also be software on an ordinary server, an x86 router, named after the kind of processor in most PCs and servers. RouterOS runs on a virtual machine as CHR, and open projects such as FD.io's VPP forward packets in software on x86 and other processors. An x86 router forwards on its CPU, with everything that means: whatever features its software has, a table as big as its memory, and a limit in packets a second set by its processor and its network cards. It is a good fit for a router with modest traffic and many features, and for a lab.

Licences decide part of what you get, on hardware and software alike. CHR is an example: its free licence limits each interface to 1 Mbit/s of upload, and its paid levels to 1 Gbit/s, to 10 Gbit/s or to no limit. Before you count on a port, a speed or a feature, read what the licence covers.

<TryIt title="State what a device must do, and see what kind fits">

Answer the three questions, then change the frame size and watch the packets a second change. Try a full table at 10 Gbit/s, then at 100 Gbit/s, then NAT for all traffic at 100 Gbit/s.

<DeviceClass />

</TryIt>

The kind of device follows from two things: whether the work per packet fits in a chip, and whether the table fits in the chip. When both fit, a chip forwards at wire speed. When the table does not fit, either buy a chip with a bigger table or send fewer routes to it. When the work does not fit, use the CPU, and split the job if the traffic is too much for one.

<Quiz
  question="An edge router takes the full table and runs at most 5 Gbit/s, with a stateful firewall on all of it. Which device fits?"
  :choices="['A switch that routes in its chip, with a small table', 'A router that forwards on its CPU, or an x86 router', 'A router whose chip holds the full table']"
  :answer="1"
  :why="['The table is over a million routes, and the firewall tracks connections. A small chip does neither.', '', 'Its chip would hold the table, but a stateful firewall on all traffic is CPU work, so the chip would not be forwarding it anyway.']"
  explain="5 Gbit/s is within reach of a CPU, which holds the full table in main memory and can track every connection. Check its packets a second at small frames."
/>

## Ports in Circuit

Circuit names a port by its speed class and its position in that class, the same way on every platform: `25g-1` is the first 25G port, `100g-2` the second 100G port. Each platform's `models.ts` lists how many ports of each speed a model has, and how the platform spells them:

| Platform       | Model               | Ports                        | `100g-1` on the device       |
| -------------- | ------------------- | ---------------------------- | ---------------------------- |
| `routeros`     | CCR2216-1G-12XS-2XQ | 2 x 100G, 12 x 25G, 1 x 1G   | `qsfp28-1-1`                 |
| `vrp`          | CE6855-48S6Q-HI     | 6 x 40G, 48 x 10G            | none; `40g-1` is `40GE1/0/1` |
| `raisecom-ros` | RAX721-C-6C48       | 6 x 100G, 24 x 25G, 24 x 10G | `hundredgige 1/1/1`          |

A port that does not exist is caught before anything is sent. In the file, the editor marks it; `circuit validate` says:

```text
error  edge-b1: port 25g-13 does not exist on CCR2216-1G-12XS-2XQ
```

## Optics: the plug and the fibre

A fast port on a switch or router is usually an empty cage. Into it goes an <Term means="A small module that plugs into a port and turns its electrical signal into light on a fibre, and back. Also called a transceiver.">optic</Term>, and the optic sets the kind of fibre and the distance. The cage's shape sets which optics fit:

| Cage   | Speed | Lanes | Also takes |
| ------ | ----- | ----- | ---------- |
| SFP    | 1G    | 1     |            |
| SFP+   | 10G   | 1     | SFP        |
| SFP28  | 25G   | 1     | SFP+, SFP  |
| QSFP+  | 40G   | 4     |            |
| QSFP28 | 100G  | 4     | QSFP+      |

SFP, SFP+ and SFP28 are the same size, so a 25G cage takes a 10G optic, which then runs at 10G. A lane is one stream of bits, and a QSFP cage has four side by side, so a 100G QSFP28 port can also be split into four 25G ports with a breakout cable.

Fibre comes in two kinds. <Term means="Fibre with a wide core, 50 micrometres in OM3 and OM4, that carries light along many paths at once. The paths spread a pulse out, so it reaches only short distances, but the optics are simpler.">Multimode</Term> fibre, OM3 or OM4, is for short runs inside a room or a building. <Term means="Fibre with a narrow core, about 9 micrometres in OS2, that carries light along one path. A pulse keeps its shape over many kilometres.">Single-mode</Term> fibre, OS2, reaches kilometres, and is what runs between buildings and cities. An optic is made for one kind, and in the optics below its name says which: **SR**, short range, for multimode, and **LR**, long reach, or **ER**, extended reach, for single mode. A 4 at the end, as in SR4, means four lanes.

| Optic                     | Fibre    | Reach                           |
| ------------------------- | -------- | ------------------------------- |
| 10GBASE-SR                | OM3, OM4 | 300 m, 400 m                    |
| 10GBASE-LR                | OS2      | 10 km                           |
| 25GBASE-SR                | OM3, OM4 | 70 m, 100 m                     |
| 25GBASE-LR                | OS2      | 10 km                           |
| 40GBASE-SR4, 100GBASE-SR4 | OM3, OM4 | 100 m and 150 m; 70 m and 100 m |
| 40GBASE-LR4, 100GBASE-LR4 | OS2      | 10 km                           |
| 100GBASE-ER4              | OS2      | 40 km                           |

The SR4 optics send on eight fibres, four each way, through an MPO connector, one plug that holds them all; the other optics in the table use one pair of fibres. For a few metres inside one rack, a <Term means="Direct attach cable: two plugs joined by a short copper cable, used instead of two optics and a fibre for a link inside a rack.">DAC</Term> replaces two optics and the fibre; a passive one for SFP+ reaches up to about 7 metres.

<TryIt title="Light four links of the full-setup example">

Pick the link, then an optic for each end and the fibre. Light it. When a link comes up, see how its ports are written in Circuit.

<OpticMatcher />

</TryIt>

A link comes up only when four things hold: each optic fits its cage, both ends are the same standard, the fibre is the kind the optic is made for, and the run is within its reach. When an optic is slower than its cage, Circuit's `speed` says so, as `edge-a1` does for its 100G port with a 40G optic in it, and `circuit validate` refuses two ends of a cable at different speeds:

```text
error  edge-a1: port 100g-1 link: speed 40g, and edge-a2 100g-1 is 100g
```

On Raisecom switches, `system.transceiver_monitoring` turns on reading each optic's temperature, power and voltage, so you can watch its light levels; RouterOS always reads them.

<Quiz
  question="Two buildings 2 km apart are joined by single-mode fibre. Both routers have SFP28 cages. Which optic goes in each?"
  :choices="['25GBASE-SR in both', '25GBASE-LR in both', '25GBASE-SR in one and 25GBASE-LR in the other']"
  :answer="1"
  :why="['SR is made for multimode fibre and reaches 100 m at most, on OM4.', '', 'Both ends must be the same standard. These two send light differently and never hear each other.']"
  explain="LR is made for single-mode fibre and reaches 10 km, so 2 km is well within it, and both ends must be the same standard."
/>

## Further reading

- [L3 Hardware Offloading](https://help.mikrotik.com/docs/spaces/ROS/pages/62390319/L3+Hardware+Offloading), MikroTik's documentation: routing in the switch chip, the CCR2216's route limits, and the choice between the chip and the firewall.
- [BGP in 2025](https://blog.apnic.net/2026/01/08/bgp-in-2025/), Geoff Huston on the APNIC Blog: the size of the IPv4 and IPv6 tables at the start of 2026, and why the FIB size is what you buy.
- [Catalyst 6500 Series Switches: 512K route limit](https://www.cisco.com/c/en/us/support/docs/switches/catalyst-6500-series-switches/117712-problemsolution-cat6500-00.html), Cisco's note on what happened when the table passed 512,000 routes in 2014, and the fix.
- [Ethernet frame](https://en.wikipedia.org/wiki/Ethernet_frame), on Wikipedia: the preamble, the gap between frames, and the smallest frame.
- [Cloud Hosted Router](https://help.mikrotik.com/docs/spaces/ROS/pages/18350234/Cloud+Hosted+Router+CHR), MikroTik's documentation: RouterOS on x86, and its licence levels.
- [FD.io VPP](https://s3-docs.fd.io/vpp/25.06/), an open software packet forwarder.
- [Small Form-factor Pluggable](https://en.wikipedia.org/wiki/Small_Form-factor_Pluggable), on Wikipedia: SFP to QSFP28, which cages take which optics, breakouts and DACs.
- Reaches, on Wikipedia: [10 Gigabit Ethernet](https://en.wikipedia.org/wiki/10_Gigabit_Ethernet), [25 Gigabit Ethernet](https://en.wikipedia.org/wiki/25_Gigabit_Ethernet), [100 Gigabit Ethernet](https://en.wikipedia.org/wiki/100_Gigabit_Ethernet) (which also covers 40G).
- [Multi-mode optical fiber](https://en.wikipedia.org/wiki/Multi-mode_optical_fiber) and [Single-mode optical fiber](https://en.wikipedia.org/wiki/Single-mode_optical_fiber), on Wikipedia.

## In short

- A chip forwards at wire speed but holds a fixed table and does only what it was built for; a CPU does anything to a packet and holds a big table, but has a limit in packets a second.
- The full table was about 1,050,000 IPv4 and 242,000 IPv6 routes at the start of 2026, and grows every year. A router that forwards it in a chip needs a FIB with room to grow; one that does not need it can take a default route.
- Check forwarding rates in packets a second at small frames, and read what a licence covers.
- An optic must fit its cage, match the far end, suit the fibre and reach the distance: SR on multimode for short runs, LR and ER on single mode for long ones.
- In Circuit, ports are named by speed and position from `models.ts`, `speed` marks a slower optic, and `hardware_offload` chooses chip or CPU.
