---
title: A native VLAN is a dead end
description: Give a trunk a native VLAN only when the far end sends untagged frames, and keep that VLAN on the one device, so nobody can hop from it into another VLAN.
---

# A native VLAN is a dead end

Give a trunk a native VLAN only when the far end sends untagged frames, and keep that VLAN on the one device: no other port there carries it.

## Why

A trunk sends its native VLAN's frames without a tag. That opens two holes:

- **VLAN hopping.** A host in the native VLAN sends a frame with two tags: the native VLAN outside, and a victim's VLAN inside. The first switch sends it out of the trunk as native, without the outer tag. The next switch reads the inner tag, and delivers the frame into the victim's VLAN. No router or firewall ever sees it.
- **Untagged traffic travels.** A VLAN native on two trunks joins whatever sends untagged frames at both far ends, such as a provider's handoff and another switch, with no tag to show it.

## In Circuit

`native_vlans_are_dead_ends: true` in `circuit.ts` turns on the check. It stops on a VLAN that is native on more than one trunk of a device, or that is also an access or tagged VLAN anywhere on that device. So no host on the device is in its native VLAN, and untagged frames from one trunk reach no other port.

Where the far end sends some frames untagged, end the native VLAN at a VLAN interface on the device itself. If the provider of the [single site example](/guide/examples#a-single-site) sent the internet untagged and its IPTV tagged on one port, the router would write:

```ts
interfaces: {
    ethernet: {
        "1g-1": { description: "Internet provider", trunk_vlans: ["iptv"], native_vlan: "internet" },
    },
    vlan_interface: {
        internet: { vlan: "internet", addresses: ["203.0.113.2/30"] },
    },
},
```

Carrying `internet` to the switch as well stops `validate`:

```text
  error  router: native VLAN internet is also an access or tagged VLAN on interfaces.ethernet.25g-1
```

[Trunks](/academy/elementary/trunks) explains tagged and untagged frames, and [Checks](/guide/checks#built-in-checks) lists every built-in check.
