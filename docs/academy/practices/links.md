---
title: Links written at both ends
description: Write each cable on the ports at both of its ends, and give the far device and port in each port's description. Circuit checks that both ends agree.
---

# Links written at both ends

Write each cable on both of its ports, and give the device and port at the other end in each port's description.

## Why

A cable has two ends, and a change made at one end only breaks it quietly. The link still comes up, but:

- a VLAN on one end only never reaches the other;
- an MTU that differs drops large packets, and can keep OSPF from forming;
- a speed that differs, or a LAG on one end only, can leave the link down.

The description tells whoever stands at the rack, or reads the device's config, where the cable goes.

## In Circuit

`link` on a port gives the device and port at the other end. `circuit validate` stops when the far end doesn't link back, and when the two ends disagree on VLANs, LAG, speed, MTU, or addresses. It warns when a port's description doesn't give the far device and port as that device prints them. While `diff` and `apply` are connected, they also warn when LLDP finds a cable in another port than `link` says.

The two ends of the trunk in the [single site example](/guide/examples#a-single-site), on the router and on the switch:

<<< @/../examples/single-site/sites/home/router.ts#trunk

<<< @/../examples/single-site/sites/home/switch.ts#trunk

Each description uses the far device's own name for the port: the switch runs VRP, which prints `10g-1` as `10GE1/0/1`, and the router runs RouterOS, which prints `25g-1` as `sfp28-1`. With `guests` left off the switch's end, `validate` stops:

```text
  error  router: interfaces.ethernet.25g-1.link: interfaces.ethernet.25g-1 carries VLANs 10, 20, 30 tagged, and switch interfaces.ethernet.10g-1 carries VLANs 10, 20 tagged
  error  switch: interfaces.ethernet.10g-1.link: interfaces.ethernet.10g-1 carries VLANs 10, 20 tagged, and router interfaces.ethernet.25g-1 carries VLANs 10, 20, 30 tagged
```

[Trunks](/academy/elementary/trunks) and [Staying up](/academy/intermediate/redundancy) cover trunks and LAGs, and [Make a change](/guide/apply#making-the-plan) covers the LLDP check.
