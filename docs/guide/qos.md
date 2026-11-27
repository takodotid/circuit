---
description: Sort the packets an interface sends into classes by the DSCP or PCP their port trusts, and send each class from its own queue, strict queues first and the others by share, each queue as deep as you set it. Give each customer a rate of its own.
---

# Quality of service

A device tells traffic apart by the DSCP each packet carries (RFC 2474). [Marking](/guide/rules#marking) sets the DSCP. Classes sort packets by it where their port trusts it, and a scheduler sends each class from its own queue, so calls go out first and backups wait.

## Classes

`qos.classes` sorts packets into classes by their DSCP, RFC 2475's behavior aggregates, where their port trusts it. A DSCP is in one class at most. `default_class` takes every packet that no other class takes, and it is needed with `classes`. RFC 4594 says which DSCP each kind of traffic takes, such as `ef` for calls and `cs6` for routing protocols.

The routers of one network sort traffic alike, so the campus example writes its classes once, beside the network, and each router takes them:

<<< @/../examples/campus/circuit.ts#classes

A packet's class is decided after `qos.marking`, so a packet that a marking rule marks lands in its new class, whatever its port trusts. To sort packets by their address or port, mark their DSCP, or give them a class in the marking rule:

<<< @/../examples/campus/sites/library/library-01.ts#class

A packet a marking rule gives a `class` takes that class's queue on this device, whatever its DSCP. It leaves with its DSCP unchanged, unless the rule also sets `dscp`, so the next device sorts it by its DSCP.

A class can also list PCPs: the priority in the VLAN tag a packet arrives with (IEEE 802.1Q). Use it for devices that set a PCP and no DSCP, such as a switch that tags the calls of older phones. The library's router adds PCP 5 to the campus's voice class:

<<< @/../examples/campus/sites/library/library-01.ts#pcp

A packet's class is the first of these:

1. the class a marking rule gives it: its `class`, or the class that lists the DSCP it writes
2. where its port trusts the DSCP, the class that lists the DSCP it leaves with
3. where its port trusts the PCP, the class that lists the PCP it arrives with
4. `default_class`

So a DSCP that a class lists goes before the PCP, where a port trusts both. What `default_class` lists only shows what it holds. A packet that arrives without a tag has PCP 0, as IEEE 802.1Q gives it its port's default priority. A marking rule's `pcp` changes the PCP a packet leaves with, not its class.

FortiOS sorts sessions, not packets. The first packet of a session picks the class of every packet of it, both ways, and a marking rule marks the packets that go the way of that first packet. So a reply takes the class of its request, whatever DSCP it carries. The firewall's own traffic takes `default_class`.

## What a port trusts

A port, a LAG, or a VLAN interface trusts nothing unless its `qos_trust` says so. A packet that arrives on it then takes `default_class` unless a marking rule gives it a class: its DSCP and PCP pick no class there. So a customer that marks everything EF doesn't jump the queue. `qos_trust` lists what it trusts: `["dscp"]`, `["pcp"]`, or both, the DSCP first. The library's router trusts the DSCP its own network's routers set, and the PCP the library switch sets, but no DSCP a laptop sets:

<<< @/../examples/campus/sites/library/library-01.ts#trust

Trust only picks the class. A packet leaves with the DSCP and PCP it arrived with, trusted or not, as RFC 2474 forwards a packet whose DSCP it doesn't act on without changing it. To overwrite what a port lets in, write a [marking](/guide/rules#marking) rule with `in_interface` that sets the DSCP you want. A VLAN tag ends at the router, so a routed packet leaves with the PCP a marking rule sets.

`validate` warns when the classes list DSCPs or PCPs that no port trusts: then only marking rules give those classes. Packets the device sends itself arrive on no port, so trust doesn't change their class. Where each platform trusts, and how, is on [Platforms](/reference/platforms#firewall-and-services).

## Schedulers

A scheduler sends what leaves an interface: one queue for each class. A port, a LAG, or a VLAN interface takes one with `scheduler`:

<<< @/../examples/campus/sites/field-station/field-01.ts#queues

- `rate` is the rate of everything the interface sends, the parent of its queues (hierarchical shaping). Set it below the interface's speed, or below the slowest link after it, such as a radio. Packets wait in their queues only when more comes than the rate.
- A **strict** queue is sent before every weighted queue. `max` caps it, so it can't starve the others: what comes faster is dropped. Several strict queues take turns.
- A **weighted** queue's `share` is its part of what the strict queues leave, in percent. The shares of a scheduler add up to 100. When a queue sends less than its share, the others take the rest.
- Each scheduler has one queue for each class, so no class is left out. `validate` says which class has none.

A scheduler shapes what leaves the interface, so it is not written beside `shaping` or `rate_limit.output` on the same interface: write its `rate` instead. Packets the device sends itself go into their class's queue too, except on FortiOS, where they take `default_class`.

Which platforms build schedulers, and what each needs, is on [Platforms](/reference/platforms). On a switch such as a CloudEngine, a port has 8 queues and a scheduler has one strict queue.

## Queue depth and RED

A queue holds the packets that wait to be sent. `depth_packets` is the most it holds: what comes while it is full is dropped, which is called tail drop. A deeper queue drops less in a burst, but a packet at its end waits longer. Without `depth_packets`, the queue keeps the platform's own depth.

`red` drops packets at random before the queue is full: random early detection (RED, RFC 2309). Below `min_threshold_percent` of the depth, on average, no packet is dropped early. Above `max_threshold_percent`, every packet that comes is dropped. Between them, a packet is dropped at random, more often as the queue fills. A TCP sender slows down when it loses a packet, so it slows down before the queue is full, and the queue stays short. `red` needs `depth_packets`. The field station's best-effort queue uses it, in the scheduler above.

RFC 7567 asks every device to manage its queues, and no longer asks for RED by default. The thresholds of RED need tuning for each link. Every packet of a queue meets the same thresholds, whatever its drop precedence: `af41`, `af42`, and `af43` are dropped alike (RFC 2597). WRED, with thresholds for each drop precedence, is not built yet ([#215](https://github.com/takodotid/circuit/issues/215)).

## A rate for each customer

`rate_limit` holds a port, a LAG, or a VLAN interface to a rate as a whole. `per_prefix` gives each customer on it a rate of its own instead, or as well. Each prefix of the lengths you write gets `input` and `output`: `ipv4: 32` and `ipv6: 128` limit each address, and `ipv6: 56` each customer's /56. What arrives is counted by its source, and what leaves by its destination, so write it on the interface toward the customers. The library's guest Wi-Fi:

<<< @/../examples/campus/sites/library/library-01.ts#per-prefix

Beside the interface's own `input` and `output`, the customers share those rates, each up to its own. A customer's IPv4 and IPv6 traffic each get the rates. Hosts that make their IPv6 addresses in one /64 need `ipv6: 128`, and then each address a host makes gets the rates. [Platforms](/reference/platforms#interfaces) says where it works.

A rate limit has one rate each way. Policing with a second rate, RFC 2698's two-rate three-color marker, is not built: [Platforms](/reference/platforms#firewall-and-services) says why.
