---
title: Trunks
description: Carry many VLANs over one cable between two switches. Watch each frame get a VLAN tag on the trunk, and see what breaks when the two ends disagree.
---

# Trunks

A trunk is a port that carries several VLANs over one cable. On a trunk, each frame carries a small tag with its VLAN number, so the device at the other end knows which VLAN the frame belongs to. The tag is added when a frame goes onto the trunk and removed when it leaves it.

Both ends of a trunk must carry the same VLANs. If they do not, frames of the missing VLAN are dropped, and Circuit catches that before anything is sent.

## One cable, many VLANs

In [the last lesson](/academy/elementary/vlans), the router needed one cable for each VLAN. Two switches on two floors have the same problem: if both floors have staff, guests and cameras, joining them with one cable per VLAN takes three cables, and every new VLAN takes another.

A <Term means="A switch port that carries several VLANs at once, with a tag on each frame saying which VLAN it belongs to. Used between switches, and between a switch and a router.">trunk</Term> carries them all on one. Here is what happens to a frame from a camera on the first floor to a recorder on the second:

1. The camera sends an ordinary frame to its access port, in VLAN 40. It knows nothing about VLANs.
2. The first switch sends the frame out of its trunk port, and adds a tag that says "VLAN 40" as it goes.
3. The second switch receives it on its trunk port, reads the tag, and knows the frame belongs to VLAN 40.
4. It takes the tag off and sends the frame out of its access port in VLAN 40, to the recorder.

The devices at the ends never see a tag. Only the trunk does.

All the VLANs on a trunk share its speed. If the guests on one floor are downloading a large file, there is that much less room on the trunk for everyone else. That is why a trunk is usually the fastest port a switch has: in this lesson, the switches are joined by their 40G ports, while each device is on a 10G port.

<TryIt title="Send frames over a trunk">

<TrunkTags />

</TryIt>

The label over each frame showed when it had a tag: only on the trunk. When one end stopped carrying a VLAN, frames of that VLAN were dropped, either before they left or when they arrived. Nothing told the camera; its frames simply never arrived. That is why both ends must agree, and why it is worth having a tool check it.

<Quiz
  question="The camera on switch-a is in VLAN 40. switch-a carries 20, 30 and 40 on its trunk, but switch-b carries only 20 and 30. What happens to the camera’s frames for the recorder on switch-b?"
  :choices="['They arrive, because switch-a sent them', 'switch-b drops them, because it does not carry VLAN 40 on that port', 'switch-b puts them in VLAN 20 instead']"
  :answer="1"
  :why="['Sending is half of it. The far end also has to accept VLAN 40 on its trunk port.', '', 'A switch never moves a frame to another VLAN. A frame with a tag it does not carry is dropped.']"
  explain="switch-a tags the frames with 40 and sends them, but switch-b does not carry VLAN 40 on its trunk port, so it drops every frame with that tag."
/>

## The tag

The tag is defined by a standard called <Term means="The standard that adds a VLAN tag to a frame. People often say dot1q, after its name, IEEE 802.1Q.">802.1Q</Term>. It is 4 bytes, put into the frame header right after the hardware address the frame is from. Its last 12 bits hold the VLAN ID.

Twelve bits can count from 0 to 4095, as you saw in [Counting like a computer](/academy/beginner/binary). Two of those values are kept back by the standard, which is why a VLAN ID is 1 to 4094. Try some numbers, including 0, 4095 and 5000:

<TryIt title="Write a VLAN ID into the tag">

<TagBits />

</TryIt>

<Quiz
  question="Why can there be no VLAN 5000?"
  :choices="['Switches are not fast enough for that many VLANs', 'The tag has only 12 bits for the VLAN ID, and they stop at 4095', 'Circuit does not allow it, but other tools do']"
  :answer="1"
  :why="['Speed has nothing to do with it. The limit is the size of the tag.', '', 'The limit is in the tag itself, so every switch has it. Circuit only checks it for you.']"
  explain="5000 needs 13 bits, and the tag has room for 12. Every switch that uses 802.1Q tags has the same limit."
/>

## Trunks in Circuit

A trunk port lists its VLANs in `trunk_vlans`, by name. Here is the whole file of `switch-a` from the widget. The VLANs come from `site.ts`, one file both switches share, so the two can never have different numbers for the same VLAN:

```ts
// site.ts
import type { Vlan } from "@takodotid/circuit";

export const vlans = {
    home: { id: 20, description: "Home" },
    guests: { id: 30, description: "Guests" },
    cameras: { id: 40, description: "Cameras" },
} as const satisfies Record<string, Vlan>;
```

```ts
// switch-a.ts
import { defineDevice, secret } from "@takodotid/circuit";
import { vlans } from "./site";

export default defineDevice({
    name: "switch-a",
    platform: "vrp",
    model: "CE6855-48S6Q-HI",
    connection: { host: "192.168.10.2", user: "operator" },
    users: { operator: { role: "admin", password: secret("SWITCH_PASSWORD") } },

    vlans,

    ports: {
        "10g-1": { description: "Laptop", access_vlan: "home" },
        "10g-2": { description: "Guest access point", access_vlan: "guests" },
        "10g-3": { description: "Camera", access_vlan: "cameras" },
        "40g-1": {
            description: "Switch B",
            trunk_vlans: ["home", "guests", "cameras"],
            link: { device: "switch-b", port: "40g-1" },
        },
    },
});
```

The `link` says what is at the other end of the cable: `switch-b`, port `40g-1`. `switch-b` has the same port with a `link` back to `switch-a`. With a link on both ends, `circuit validate` checks that the two ports really are the two ends of one cable, and that they carry the same VLANs in the same way. When they do not, it stops before anything is sent:

```text
  error  switch-a: port 40g-1 link: carries {"trunk":[20,30,40]}, and switch-b 40g-1 carries {"trunk":[20,40]}
  error  switch-b: port 40g-1 link: carries {"trunk":[20,40]}, and switch-a 40g-1 carries {"trunk":[20,30,40]}

2 error(s).
```

This is the most common trunk mistake there is. Someone adds a VLAN for a new team, puts it on the trunk of the switch on their own floor, and forgets the other end. The new VLAN works on one floor and nowhere else, and nobody sees an error, because each switch on its own is set up correctly. Only the two ends together are wrong, and only a check that reads both ends finds it.

Without `link`, Circuit cannot know which ports face each other, so it cannot check them. Write it on both ends of every cable between two of your devices. [Circuit Studio](/studio/graph) draws your cables from the same links.

::: tip Untagged frames on a trunk
Some devices send frames without a tag on a trunk, often for their own management. `native_vlan` says which VLAN those untagged frames belong to: `{ trunk_vlans: ["mgmt", "home"], native_vlan: "mgmt" }`. Both ends must agree on it too, and `link` checks that as well. Leave it out unless the other end needs it.
:::

## A trunk to the router

A router can be on a trunk too, so one cable carries every VLAN to it. This is how Circuit's single-site pattern joins its router and switch:

```ts
// router.ts
"25g-1": {
    description: "Switch",
    speed: "10g",
    trunk_vlans: ["mgmt", "home", "guests"],
    link: { device: "switch", port: "10g-1" },
},
```

The router still needs an address in each VLAN to be its gateway. With every VLAN on one port, those addresses go on a VLAN interface instead of a port, which the [next lesson](/academy/elementary/dhcp) sets up.

## In short

- A trunk carries several VLANs on one cable, between two switches or a switch and a router.
- On a trunk, each frame carries an 802.1Q tag with its VLAN ID. The tag is added as the frame goes onto the trunk and removed as it leaves.
- The VLAN ID has 12 bits in the tag, and 0 and 4095 are kept back, so VLANs are 1 to 4094.
- Both ends must carry the same VLANs, or frames of the missing VLAN are dropped.
- In Circuit, a trunk port lists `trunk_vlans`, and a `link` on both ends lets `circuit validate` check that they match.
