---
title: VLANs
description: Split one switch into separate networks with VLANs. Put ports in VLANs, see where a broadcast goes, and write the VLANs in Circuit.
---

# VLANs

A VLAN is a separate network inside one switch. You put each port of the switch in a VLAN, and the switch passes frames only between ports in the same VLAN, as if each VLAN were a switch of its own.

Devices in different VLANs cannot reach each other through the switch at all. To cross from one VLAN to another, traffic has to go through a router.

## One switch, several networks

Think of an office with one switch. Staff laptops, a printer, a Wi-Fi access point for guests and some security cameras all plug into it. Without VLANs, they are all one local network: a guest's phone can find the printer, and the cameras can be reached from any laptop. Every broadcast from every device reaches every other device.

You could buy a switch for each group, but VLANs do the same with one. A <Term means="Virtual LAN: a separate local network inside a switch. Ports in one VLAN cannot reach ports in another through the switch.">VLAN</Term> has a number from 1 to 4094, called its ID, and people usually give it a name too, such as "guests". The [Trunks](/academy/elementary/trunks) lesson shows where that number comes from.

The simplest way to use a VLAN is an <Term means="A switch port that is in exactly one VLAN. The device plugged into it sends and receives ordinary frames, and does not know the VLAN exists.">access port</Term>: a port that is in one VLAN. The device plugged into it does not know VLANs exist. It sends and receives ordinary frames, exactly as before. Only the switch knows which VLAN each port is in, and it keeps a separate address table for each VLAN.

Try it on a switch with six devices. Every port starts in the same VLAN, so the switch behaves like a plain switch.

<TryIt title="Split a switch into VLANs">

<VlanPainter />

</TryIt>

A broadcast reached every port in the sender's VLAN, and no port outside it. That is the second reason to use VLANs: a broadcast stays inside its VLAN, so a big network split into VLANs has less noise on each part. A message to one device in another VLAN went nowhere, because the switch will not pass a frame from one VLAN to another.

<Quiz
  question="The guest Wi-Fi port is in VLAN 30, and every other port is in VLAN 20. A guest’s phone sends a broadcast. Who receives it?"
  :choices="['Every device on the switch', 'Only devices on ports in VLAN 30', 'Nobody, because a VLAN blocks broadcasts']"
  :answer="1"
  :why="['The switch keeps each VLAN apart, broadcasts too. The ports in VLAN 20 never see it.', '', 'A broadcast still reaches everyone in its own VLAN. It just stops at the edge of the VLAN.']"
  explain="A broadcast stays inside its VLAN. Here that is the guest Wi-Fi port and anything else in VLAN 30, and none of the staff devices."
/>

## Writing VLANs in Circuit

Look at the file the widget wrote. Two fields do all the work:

- `vlans` lists the VLANs the switch has. Each one is written under its name, with its `id` and a `description` for people.
- `access_vlan` on each port says which VLAN that port is in. You write the VLAN's name, not its number: `access_vlan: "guests"`, never `30`.

A port you set to "not in the file" vanished from `ports`, and its device went dark. That is the rule from [the last lesson](/academy/elementary/writing-it-down): a port the file does not list is shut down. A spare wall socket is safe until someone writes it down.

Circuit checks every VLAN name a port uses. If you write `"camera"` where the VLAN is called `"cameras"`, your editor underlines it, and `circuit validate` stops with:

```text
  error  switch: port 10g-5 VLAN 'camera' is not declared
```

It also refuses a VLAN ID outside 1 to 4094, and two VLANs with the same ID. When a file is right, Circuit turns each port into the switch's own commands. `npx circuit build switch` prints them; this is port `10g-5` on the switch in the widget:

```text
interface 10GE1/0/5
 description Camera
 port default vlan 40
```

## Choosing your VLANs

Split by who needs to reach what, not by floor or by room. A small site usually needs only a few VLANs. Circuit's [single-site pattern](/patterns/single-site), which the last lesson of this level builds, uses three:

| VLAN     | ID  | For                                                                |
| -------- | --- | ------------------------------------------------------------------ |
| `mgmt`   | 10  | The switches' and router's own addresses, where you log in to them |
| `home`   | 20  | The people who live or work there, and their printers              |
| `guests` | 30  | Visitors, who get the internet and nothing else                    |

A VLAN for cameras, or for phones, is common too. The IDs are your choice; a number that is easy to remember, such as 20 for the network `192.168.20.0/24`, saves mistakes later. Many switches put every port in VLAN 1 before they are set up, so a common habit is to leave VLAN 1 unused and give every port a VLAN on purpose.

## Crossing from one VLAN to another

Each VLAN is usually its own IP network, too: here, VLAN 20 uses `192.168.20.0/24` and VLAN 40 uses `192.168.40.0/24`. You know from [Routers](/academy/beginner/routers) what a device does with an address that is not on its own network: it sends the packet to its gateway, a router. So to join two VLANs, you need a router with an address in each one, and that address is the gateway of the VLAN.

<TryIt title="Join two VLANs with a router">

<VlanRouter />

</TryIt>

The packet went up to the router in VLAN 20 and came back down in VLAN 40. The switch kept the VLANs apart the whole time; the router did the crossing, because it has an address on both networks.

This is also why VLANs make a network safer. Every packet from one VLAN to another passes through the router, so the router is the one place to decide what may cross. The [Firewalls](/academy/elementary/firewall) lesson writes those rules: guests may reach the internet but not the printer, for example.

<Quiz
  question="A laptop in VLAN 20 needs to print to a printer in VLAN 30 on the same switch. What does it need?"
  :choices="['Nothing, because they share a switch', 'A router with an address in both VLANs', 'The printer’s hardware address']"
  :answer="1"
  :why="['Sharing a switch is not enough. The switch never passes a frame from one VLAN to another.', '', 'Knowing the address does not help. No frame from VLAN 20 ever reaches a port in VLAN 30.']"
  explain="Only a router can take a packet from one VLAN to another. It needs an address in each VLAN, and the laptop sends to the router as its gateway."
/>

In Circuit, the setup in the widget is two more ports on the switch, each in one VLAN and both cabled to the router:

```ts
// switch.ts
"10g-7": { description: "Router, home", access_vlan: "home" },
"10g-8": { description: "Router, cameras", access_vlan: "cameras" },
```

and two ports on the router, each with the gateway address of its VLAN:

```ts
// router.ts
ports: {
    "25g-1": { description: "Switch, home", addresses: ["192.168.20.1/24"] },
    "25g-2": { description: "Switch, cameras", addresses: ["192.168.40.1/24"] },
},
```

This works, but it takes one cable and one router port for every VLAN. With ten VLANs, that is ten cables. The next lesson puts them all on one cable.

## In short

- A VLAN is a separate network inside a switch, with an ID from 1 to 4094 and usually a name.
- An access port is in one VLAN, and the device on it does not know VLANs exist.
- A broadcast stays inside its VLAN, and the switch never passes a frame from one VLAN to another.
- To cross between VLANs you need a router with an address in each, which is the gateway of that VLAN.
- In Circuit, `vlans` lists each VLAN by name, and `access_vlan` says which one a port is in.
