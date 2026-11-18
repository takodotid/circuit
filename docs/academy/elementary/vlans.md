---
title: VLANs
description: Split one switch into separate networks with VLANs. Put ports in VLANs, see where a broadcast goes, and write the VLANs in Circuit.
---

# VLANs

A VLAN is a separate network inside one switch. You put each port of the switch in a VLAN. The switch passes frames only between ports in the same VLAN, as if each VLAN were a switch of its own.

## One switch, several networks

Think of an office with one switch. Staff laptops, a printer, a Wi-Fi access point for guests, and some security cameras all plug into it. Without VLANs, they are all one local network: a guest's phone can find the printer, and the cameras can be reached from any laptop. Every broadcast from every device reaches every other device.

You could buy a switch for each group, but VLANs do the same with one. A <Term means="Virtual LAN: a separate local network on the same switches, with a number from 1 to 4094. A device in one VLAN reaches another VLAN only through a router.">VLAN</Term> has a number from 1 to 4094, called its ID, and people usually give it a name too, such as "guests". The [Trunks](/academy/elementary/trunks) lesson shows where that number comes from.

The simplest way to use a VLAN is an <Term means="A switch port in exactly one VLAN. The device on it sends and receives untagged frames, and does not know the VLAN exists.">access port</Term>: a port that is in one VLAN. The device plugged into it sends and receives ordinary frames, and does not know VLANs exist. Only the switch knows which VLAN each port is in, and it keeps a separate address table for each VLAN.

<TryIt title="Split a switch into VLANs">

<VlanPainter />

</TryIt>

A broadcast stays inside its VLAN. That is a second reason to use VLANs: a big network split into VLANs has less noise on each part.

<Quiz
  question="The guest Wi-Fi port is in VLAN 30, and every other port is in VLAN 20. A guest’s phone sends a broadcast. Who receives it?"
  :choices="['Every device on the switch', 'Only devices on ports in VLAN 30', 'Nobody, because a VLAN blocks broadcasts']"
  :answer="1"
  :why="['The switch keeps each VLAN apart, broadcasts too. The ports in VLAN 20 never see it.', '', 'A broadcast still reaches everyone in its own VLAN. It just stops at the edge of the VLAN.']"
  explain="A broadcast stays inside its VLAN. Here that is the guest Wi-Fi port and anything else in VLAN 30, and none of the staff devices."
/>

## Writing VLANs in Circuit

Two fields in the widget's file do all the work:

- `switching.vlans` lists the VLANs the switch has. Each one is written under its name, with its `id` and a `description` for people.
- `access_vlan` on each port says which VLAN that port is in. You write the VLAN's name, not its number: `access_vlan: "guests"`, never `30`.

A port you take out of the file is shut down, as in [Writing a network down](/academy/elementary/writing-it-down). So a spare wall socket stays off until someone writes it down.

Circuit checks every VLAN name a port uses. Write `"guest"` where the VLAN is called `"guests"`, and your editor underlines it. `circuit validate` stops on it too, and gives the file and line. Here it is in the switch of the single-site example:

```text
sites/home/switch.ts:32: switch: interfaces.ethernet.10g-4.access_vlan: no VLAN guest. Did you mean guests?
```

It also refuses a VLAN ID outside 1 to 4094, and two VLANs with the same ID. When the file is right, Circuit turns each port into the switch's own commands. For port `10g-5` in the widget, in the cameras VLAN, a Huawei VRP switch gets:

```text
interface 10GE1/0/5
 description Camera
 port default vlan 40
```

## Choosing your VLANs

Split by who needs to reach what, not by where people sit. A small site usually needs only a few VLANs. Circuit's [single-site example](/guide/examples#a-single-site) uses three:

| VLAN     | ID  | For                                                                |
| -------- | --- | ------------------------------------------------------------------ |
| `mgmt`   | 10  | The switches' and router's own addresses, where you log in to them |
| `home`   | 20  | The people who live or work there, and their printers              |
| `guests` | 30  | Visitors, who get the internet and nothing else                    |

A VLAN for cameras, or for phones, is common too. The IDs are your choice. An ID that matches the network, such as 20 for `192.168.20.0/24`, saves mistakes later. Many switches put every port in VLAN 1 before they are set up. So a common habit is to leave VLAN 1 unused, and give every port a VLAN on purpose.

## Crossing from one VLAN to another

Each VLAN is usually its own IP network, too: here, VLAN 20 uses `192.168.20.0/24` and VLAN 40 uses `192.168.40.0/24`. As in [Routers and the gateway](/academy/beginner/routers), a device sends a packet for another network to its gateway: a router. So to join two VLANs, you need a router with an address in each one, and that address is the gateway of the VLAN.

<TryIt title="Join two VLANs with a router">

<VlanRouter />

</TryIt>

This is also why VLANs make a network safer. Every packet from one VLAN to another passes through the router, so the router is the one place to decide what may cross. A [firewall](/academy/elementary/firewall) on the router decides it: guests may reach the internet but not the printer, for example.

<Quiz
  question="A laptop in VLAN 20 needs to print to a printer in VLAN 30 on the same switch. What does it need?"
  :choices="['Nothing, because they share a switch', 'A router with an address in both VLANs', 'The printer’s hardware address']"
  :answer="1"
  :why="['Sharing a switch is not enough. The switch never passes a frame from one VLAN to another.', '', 'Knowing the address does not help. No frame from VLAN 20 ever reaches a port in VLAN 30.']"
  explain="Only a router can take a packet from one VLAN to another. It needs an address in each VLAN, and the laptop sends to the router as its gateway."
/>

In Circuit, the setup in the widget is two more ports on the switch, each in one VLAN and both cabled to the router:

```ts
// switch.ts, in interfaces.ethernet
"10g-7": { description: "Router, home", access_vlan: "home" },
"10g-8": { description: "Router, cameras", access_vlan: "cameras" },
```

The router has two ports, each with the gateway address of its VLAN:

```ts
// router.ts
interfaces: {
    ethernet: {
        "25g-1": { description: "Switch, home", addresses: ["192.168.20.1/24"] },
        "25g-2": { description: "Switch, cameras", addresses: ["192.168.40.1/24"] },
    },
},
```

This works, but it takes one cable and one router port for every VLAN. The next lesson puts them all on one cable.
