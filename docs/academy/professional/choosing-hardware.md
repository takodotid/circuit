---
title: Choosing a device
description: Pick a router or switch for a role from the routes it must hold and the packets it must forward, then pick the optic and fiber for each link.
---

# Choosing a device

Pick a device by what its role asks of it:

- How many routes it must hold.
- How many packets a second it must forward.
- What it does to each packet.
- Which ports it needs.

The answers decide whether it forwards in a chip or on a CPU, and how big a table that chip must hold. Then pick an optic for each port, to match the far end and the fiber between them.

## Two ways to forward a packet

Every router has a CPU that runs its software, such as the routing protocols, the logins, and the configuration. That part is called the <Term means="The part of a router that decides: it runs BGP and OSPF, builds the routing table, and takes logins. It runs on the CPU.">control plane</Term>. Moving each packet from one port to another is the <Term means="The part of a router that moves packets from port to port, by looking up each one in the forwarding table. It runs on the CPU or in a chip.">data plane</Term>, and a device does it in one of two places.

**On the CPU.** Software handles each packet, so it can do anything to it. It can track connections for a stateful firewall or NAT, rewrite the packet, or count it. The routes it looks up live in the router's main memory, so the table can be very large. The cost is speed. The CPU does work for every packet, so its limit is in packets per second, and that limit drops as you ask more of each packet.

**In a chip.** A switch or router can have a chip built only to forward packets, an <Term means="Application-specific integrated circuit: a chip built for one job. In a switch or router, the job is looking up and forwarding packets at the full speed of its ports.">ASIC</Term>, often called the switching chip. It looks up and forwards packets at the full speed of all its ports at once, which is called <Term means="Forwarding as fast as the ports can carry, even with the smallest packets on every port at once. Also called line rate.">wire speed</Term>. The chip can only do what it was built for. Its table of routes lives in a small, fast memory of fixed size, often a <Term means="Ternary content-addressable memory: fast memory in a chip that finds the matching entry for an address in one step. It is costly, so there is little of it.">TCAM</Term>.

The table a router builds from everything it has learned is the <Term means="Routing information base: every route the router knows, from BGP, OSPF, and static routes, with all their attributes. It lives in the router's main memory.">RIB</Term>. The table the data plane looks packets up in holds only the best route for each prefix, and is the <Term means="Forwarding information base: the best route for each prefix, copied from the RIB to wherever packets are forwarded, the chip or the CPU.">FIB</Term>. On a router that forwards in a chip, the FIB is copied into the chip, and the chip's memory is what limits it.

Many devices have both. The CCR2216, the router in Circuit's examples, has a CPU and a switching chip. Its maker's documentation says three things:

- Routing in the chip is what reaches wire speed.
- Traffic routed in the chip doesn't pass the CPU's firewall.
- The chip holds up to 120,000 IPv4 routes and 20,000 IPv6 routes.

In Circuit, `hardware_offload` chooses where a device forwards:

```ts
system: { hardware_offload: true },
// ...
interfaces: {
    vlan_interface: {
        ix: {
            vlan: "ix",
            addresses: ["203.0.113.140/25", "2001:db8:ffff::140/64"],
            hardware_offload: false,
        },
    },
},
```

This router forwards in its chip, but sends traffic through the exchange interface to the CPU. The firewall applies only to traffic forwarded on the CPU, so it covers the exchange traffic. On RouterOS, Circuit writes the first line as `set switch1 l3-hw-offloading=yes`.

## How many routes it must hold

An edge router that takes the <Term means="Every route on the internet, as a transit provider sends it: a route to every prefix that anyone announces.">full table</Term> from a transit provider holds a route to every prefix on the internet. At the start of 2026 that was about 1,050,000 IPv4 routes and about 242,000 IPv6 routes, and both grow every year. A router that holds the full table needs no default route. The part of the internet where routers work that way is called the <Term means="Default-free zone: the routers of the internet that hold a route to every prefix and need no default route.">default-free zone</Term>.

In a CPU's main memory, the full table isn't what limits a router. In a chip, it is. In August 2014, the IPv4 table passed 512,000 routes. Some switches and routers in wide use had room for 512,000 IPv4 routes in their chip by default. On those, the CPU forwarded the routes past the limit. It did so slowly, under a heavy load. This went on until the chip's memory was divided differently and the device restarted. The fix took space from IPv6, because the chip itself couldn't grow.

So read the FIB size for IPv4 and for IPv6 on the datasheet, and compare each with the full table today. Leave room for years of growth. The size of that memory is what you buy when you buy the router.

Not every router needs the full table. A rack switch needs a default route and the site's own prefixes. An edge router can take only a default route from a transit, or a default and the routes it cares about, and then a much smaller chip does. The full table is for the routers that choose between several ways out.

<Quiz
  question="A router forwards in a chip that holds 120,000 IPv4 routes. You connect it to a transit provider that sends the full table. What happens?"
  :choices="['The session refuses the extra routes', 'The routes that do not fit in the chip are forwarded some other way, usually by the CPU, and slowly', 'Nothing: the chip compresses the table']"
  :answer="1"
  :why="['BGP accepts what your import policy accepts. It knows nothing about the size of the chip, unless you set max_prefixes.', '', 'The chip holds what it holds. A full table of over a million routes is far more than 120,000.']"
  explain="BGP puts every route in the RIB, but only 120,000 fit in the chip. The CCR2216 offloads the longer prefixes and leaves the rest to its CPU, the same thing that happened to routers in 2014 when the table passed 512,000."
/>

## Packets a second, not only bits a second

A port's speed is in bits a second, but the work a router does is per packet. Ethernet sends 20 more bytes on the wire with each frame: a preamble before it, and a gap after it. The smallest frame is 64 bytes. So the most packets a 10 Gbit/s port can carry is:

```text
10,000,000,000 bits / ((64 + 20) bytes x 8 bits) = 14,880,952 packets a second
```

With full 1,518-byte frames, the same port carries about 812,000 packets a second. Small packets come eighteen times as often. So a CPU router that keeps up with 10 Gbit/s of large downloads may fall far short with 10 Gbit/s of small packets. When a datasheet gives a forwarding rate, check the packet size it was measured at.

## Routers on x86 servers, and licenses

A router can also be software on an ordinary server. This is an x86 router, named after the kind of processor in most PCs and servers. RouterOS runs on a virtual machine as CHR. Open projects such as FD.io VPP forward packets in software on x86 and other processors.

An x86 router forwards on its CPU, with everything that means. It has whatever features its software has, and a table as big as its memory. Its processor and its network cards set its limit in packets a second. It is a good fit for a router with modest traffic and many features, and for a lab.

Licenses decide part of what you get from hardware as well as from software. CHR is an example. Its free license limits each interface to 1 Mbit/s of upload. Its paid levels limit it to 1 Gbit/s or 10 Gbit/s, or set no limit. Before you count on a port, a speed, or a feature, read what the license covers.

<TryIt title="State what a device must do, and see what kind fits">

Try a full table at 10 Gbit/s, then at 100 Gbit/s, then NAT for all traffic at 100 Gbit/s. Change the frame size to see the packets a second change.

<DeviceClass />

</TryIt>

The kind of device follows from two things: whether the work per packet fits in a chip, and whether the table fits in the chip. When both fit, a chip forwards at wire speed. When the table doesn't fit, buy a chip with a bigger table, or send fewer routes to it. When the work doesn't fit, use the CPU, and split the job if the traffic is too much for one.

<Quiz
  question="An edge router takes the full table and runs at most 5 Gbit/s, with a stateful firewall on all of it. Which device fits?"
  :choices="['A switch that routes in its chip, with a small table', 'A router that forwards on its CPU, or an x86 router', 'A router whose chip holds the full table']"
  :answer="1"
  :why="['The table is over a million routes, and the firewall tracks connections. A small chip does neither.', '', 'Its chip would hold the table, but a stateful firewall on all traffic is CPU work, so the chip would not be forwarding it anyway.']"
  explain="5 Gbit/s is within reach of a CPU, which holds the full table in main memory and can track every connection. Check its packets a second at small frames."
/>

## Ports in Circuit

In Circuit, a port's name is its speed class and its position in that class, the same way on every platform. So `25g-1` is the first 25G port, and `100g-2` the second 100G port. Each platform's `models.ts` lists how many ports of each speed a model has, and how the platform spells them. On the QFX5100 and the FortiGate, the two 1G ports are the out-of-band management ports.

| Platform       | Model               | Ports                        | `100g-1` on the device          |
| -------------- | ------------------- | ---------------------------- | ------------------------------- |
| `routeros`     | CCR2216-1G-12XS-2XQ | 2 x 100G, 12 x 25G, 1 x 1G   | `qsfp28-1-1`                    |
| `routeros`     | RB5009UG+S+         | 1 x 10G, 1 x 2.5G, 7 x 1G    | none; `10g-1` is `sfp-sfpplus1` |
| `vrp`          | CE6855-48S6Q-HI     | 6 x 40G, 48 x 10G            | none; `40g-1` is `40GE1/0/1`    |
| `raisecom-ros` | RAX721-C-6C48       | 6 x 100G, 24 x 25G, 24 x 10G | `hundredgige 1/1/1`             |
| `junos`        | QFX5100-48S-6Q      | 6 x 40G, 48 x 10G, 2 x 1G    | none; `40g-1` is `et-0/0/48`    |
| `fortios`      | FG-3700D            | 4 x 40G, 28 x 10G, 2 x 1G    | none; `40g-1` is `port1`        |

Circuit catches a port that doesn't exist before anything is sent. The editor marks it in the file, and `circuit validate` stops:

```text
sites/pop-1/edge-01.ts:26: edge-01: interfaces.ethernet.25g-13: CCR2216-1G-12XS-2XQ has no port 25g-13
```

## Optics: the plug and the fiber

A fast port on a switch or router is usually an empty cage. You put an <Term means="A module that slides into a cage on a switch or router and turns its signal into light on a fiber, and back.">optic</Term> into it, and the optic sets the kind of fiber and the distance. The cage's shape sets which optics fit. There are two families, <Term means="The families of modules and the cages they fit: SFP 1G, SFP+ 10G and SFP28 25G are one size; QSFP+ 40G and QSFP28 100G are wider.">SFP</Term> and the wider <Term means="The families of modules and the cages they fit: SFP 1G, SFP+ 10G and SFP28 25G are one size; QSFP+ 40G and QSFP28 100G are wider.">QSFP</Term>:

| Cage   | Speed | Lanes | Also takes |
| ------ | ----- | ----- | ---------- |
| SFP    | 1G    | 1     |            |
| SFP+   | 10G   | 1     | SFP        |
| SFP28  | 25G   | 1     | SFP+, SFP  |
| QSFP+  | 40G   | 4     |            |
| QSFP28 | 100G  | 4     | QSFP+      |

SFP, SFP+, and SFP28 are the same size, so a 25G cage takes a 10G optic, which then runs at 10G. A lane is one stream of bits, and a QSFP cage has four side by side. So a breakout cable can split a 100G QSFP28 port into four 25G ports.

Fiber comes in two kinds:

- <Term means="Fiber with a wide core, 50 micrometers in OM3 and OM4, that carries light along many paths at once. The paths spread a pulse out, so it reaches only short distances, but the optics are simpler.">Multimode</Term> fiber, OM3 or OM4, is for short runs inside a room or a building.
- <Term means="Fiber with a narrow core, about 9 micrometers in OS2, that carries light along one path. A pulse keeps its shape over many kilometers.">Single-mode</Term> fiber, OS2, reaches kilometers, and runs between buildings and cities.

An optic is made for one kind of fiber, and its name says which. **SR**, short range, is for multimode. **LR**, long reach, and **ER**, extended reach, are for single mode. A 4 at the end, as in SR4, means four lanes.

| Optic                     | Fiber    | Reach                           |
| ------------------------- | -------- | ------------------------------- |
| 10GBASE-SR                | OM3, OM4 | 300 m, 400 m                    |
| 10GBASE-LR                | OS2      | 10 km                           |
| 25GBASE-SR                | OM3, OM4 | 70 m, 100 m                     |
| 25GBASE-LR                | OS2      | 10 km                           |
| 40GBASE-SR4, 100GBASE-SR4 | OM3, OM4 | 100 m and 150 m; 70 m and 100 m |
| 40GBASE-LR4, 100GBASE-LR4 | OS2      | 10 km                           |
| 100GBASE-ER4              | OS2      | 40 km                           |

The SR4 optics send on eight fibers, four each way, through an MPO connector, one plug that holds them all. The other optics in the table use one pair of fibers. For a few meters inside one rack, a <Term means="Direct attach cable: a short copper cable with a module built onto each end, for a link inside one rack.">DAC</Term> replaces two optics and the fiber. A passive one for SFP+ reaches up to about 7 meters.

<TryIt title="Light four links of the two-site provider">

<OpticMatcher />

</TryIt>

A link comes up only when four things hold:

1. Each optic fits its cage.
2. Both ends are the same standard.
3. The fiber is the kind the optic is made for.
4. The run is within the optic's reach.

When an optic is slower than its cage, Circuit's `speed` says so. If both ends of a cable set `speed`, `circuit validate` stops when they differ:

```text
  error  edge-01: interfaces.ethernet.100g-1.link: speed 40g, and edge-02 interfaces.ethernet.100g-1 is 100g
  error  edge-02: interfaces.ethernet.100g-1.link: speed 100g, and edge-01 interfaces.ethernet.100g-1 is 40g
```

On Raisecom switches, `monitoring.transceivers` turns on reading each optic's temperature, power, and voltage, so you can watch its light levels. RouterOS, Junos, and FortiOS always read them.

<Quiz
  question="Two buildings 2 km apart are joined by single-mode fiber. Both routers have SFP28 cages. Which optic goes in each?"
  :choices="['25GBASE-SR in both', '25GBASE-LR in both', '25GBASE-SR in one and 25GBASE-LR in the other']"
  :answer="1"
  :why="['SR is made for multimode fiber and reaches 100 m at most, on OM4.', '', 'Both ends must be the same standard. These two send light differently and never hear each other.']"
  explain="LR is made for single-mode fiber and reaches 10 km, so 2 km is well within it, and both ends must be the same standard."
/>

## Further reading

- [L3 Hardware Offloading](https://help.mikrotik.com/docs/spaces/ROS/pages/62390319/L3+Hardware+Offloading), MikroTik's documentation: routing in the switch chip, the route limits of the CCR2216, and the choice between the chip and the firewall.
- [BGP in 2025](https://blog.apnic.net/2026/01/08/bgp-in-2025/), APNIC blog: the size of the IPv4 and IPv6 tables at the start of 2026, and why the FIB size is what you buy.
- [Catalyst 6500 Series Switches: 512K route limit](https://www.cisco.com/c/en/us/support/docs/switches/catalyst-6500-series-switches/117712-problemsolution-cat6500-00.html), Cisco: what happened when the table passed 512,000 routes in 2014, and the fix.
- [Ethernet frame](https://en.wikipedia.org/wiki/Ethernet_frame), on Wikipedia: the preamble, the gap between frames, and the smallest frame.
- [Cloud Hosted Router](https://help.mikrotik.com/docs/spaces/ROS/pages/18350234/Cloud+Hosted+Router+CHR), MikroTik's documentation: how RouterOS runs on x86, and its license levels.
- [FD.io VPP](https://s3-docs.fd.io/vpp/25.06/), an open software packet forwarder.
- [Small Form-factor Pluggable](https://en.wikipedia.org/wiki/Small_Form-factor_Pluggable), on Wikipedia: the cages from SFP to QSFP28, the optics each takes, breakouts, and direct attach cables.
- Reaches, on Wikipedia: [10 Gigabit Ethernet](https://en.wikipedia.org/wiki/10_Gigabit_Ethernet), [25 Gigabit Ethernet](https://en.wikipedia.org/wiki/25_Gigabit_Ethernet), and [100 Gigabit Ethernet](https://en.wikipedia.org/wiki/100_Gigabit_Ethernet), which also covers 40G.
- [Multi-mode optical fiber](https://en.wikipedia.org/wiki/Multi-mode_optical_fiber) and [Single-mode optical fiber](https://en.wikipedia.org/wiki/Single-mode_optical_fiber), on Wikipedia.

## In short

- A chip forwards at wire speed, but holds a fixed table and does only what it was built for. A CPU does anything to a packet and holds a big table, but has a limit in packets a second.
- The full table was about 1,050,000 IPv4 and 242,000 IPv6 routes at the start of 2026, and grows every year. A router that forwards it in a chip needs a FIB with room to grow. A router that doesn't need it can take a default route.
- Check forwarding rates in packets a second at small frames, and read what a license covers.
- An optic must fit its cage, match the far end, suit the fiber, and reach the distance. Use SR on multimode for short runs, and LR or ER on single mode for long ones.
- In Circuit, a port's name is its speed and position from `models.ts`, `speed` marks a slower optic, and `hardware_offload` chooses chip or CPU.
