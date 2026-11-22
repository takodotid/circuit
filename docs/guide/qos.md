---
description: Sort the packets an interface sends into classes by their DSCP, and send each class from its own queue, strict queues first and the others by share.
---

# Quality of service

A device tells traffic apart by the DSCP each packet carries (RFC 2474). [Marking](/guide/rules#marking) sets the DSCP. Classes sort packets by it, and a scheduler sends each class from its own queue, so calls go out first and backups wait.

## Classes

`qos.classes` sorts packets into classes by the DSCP they leave with, RFC 2475's behavior aggregates. A DSCP is in one class at most. `default_class` takes every DSCP that no class lists, and it is needed with `classes`. RFC 4594 says which DSCP each kind of traffic takes, such as `ef` for calls and `cs6` for routing protocols.

The routers of one network sort traffic alike, so the campus example writes its classes once, beside the network, and each router takes them:

<<< @/../examples/campus/circuit.ts#classes

A packet's class is decided after `qos.marking`, so a packet that a marking rule marks lands in its new class. To sort packets by their address or port, mark their DSCP first, or give them a class in the marking rule:

<<< @/../examples/campus/sites/library/library-01.ts#class

A packet a marking rule gives a `class` takes that class's queue on this device, whatever its DSCP. It leaves with its DSCP unchanged, unless the rule also sets `dscp`, so the next device sorts it by its DSCP.

## Schedulers

A scheduler sends what leaves an interface: one queue for each class. A port, a LAG, or a VLAN interface takes one with `scheduler`:

<<< @/../examples/campus/sites/field-station/field-01.ts#queues

- `rate` is the rate of everything the interface sends, the parent of its queues (hierarchical shaping). Set it below the interface's speed, or below the slowest link after it, such as a radio. Packets wait in their queues only when more comes than the rate.
- A **strict** queue is sent before every weighted queue. `max` caps it, so it can't starve the others: what comes faster is dropped. Several strict queues take turns.
- A **weighted** queue's `share` is its part of what the strict queues leave, in percent. The shares of a scheduler add up to 100. When a queue sends less than its share, the others take the rest.
- Each scheduler has one queue for each class, so no class is left out. `validate` says which class has none.

A scheduler shapes what leaves the interface, so it is not written beside `shaping` or `rate_limit.output` on the same interface: write its `rate` instead. Packets the device sends itself go into their class's queue too.

Which platforms build schedulers, and what each needs, is on [Platforms](/reference/platforms). Drop profiles (WRED) and a queue's depth are not built yet ([#215](https://github.com/takodotid/circuit/issues/215)).
