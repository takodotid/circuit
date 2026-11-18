---
title: One VLAN name, one ID
description: A VLAN has the same name and the same ID on every device of your network, so its name always means one VLAN.
---

# One VLAN name, one ID

A VLAN has one name and one ID, the same on every device of your network.

## Why

On the wire, a VLAN is only its ID. Its name lives in your files, your diagrams, and your team's heads. If `guests` is VLAN 30 on the router and 31 on the switch, the guests' frames cross the trunk under a tag the router doesn't give to `guests`. They land in another VLAN, or nowhere, and a review doesn't catch it, because both files say `guests`.

One ID under two names works on the wire, but reads as two VLANs.

## In Circuit

`same_vlan_ids: true` in `circuit.ts` stops the project on a VLAN name with two IDs, and shows where each is written:

```text
VLAN guests has 2 IDs: 30 on router (sites/home/site.ts:14); 31 on switch (sites/home/switch.ts:39). One VLAN name has one ID in the network (check same_vlan_ids).
```

Write each VLAN once, in a `literal` that every device uses. The [single site example](/guide/examples#a-single-site) keeps its VLANs in `site.ts`, and both devices write `vlans: home.vlans`:

<<< @/../examples/single-site/sites/home/site.ts

Across a `link`, Circuit also warns when one ID has a different name at each end. [VLANs](/academy/elementary/vlans) explains tags and IDs, and [Parts and merge](/guide/parts) explains `literal`.
