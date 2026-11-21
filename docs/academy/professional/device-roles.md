---
title: Roles in a network
description: Lay a network out in layers, from the edge through the core to the racks, and give each device a name that says its role and its place.
---

# Roles in a network

A network bigger than one room is laid out in layers, and every device in it has one role: edge, core, aggregation, or access.

## Why lay a network out by role

A network that grew one device at a time, each plugged in where there was a free port, works until something breaks. Then nobody can say which way traffic goes, which devices a failure takes down, or what a new device should look like.

Roles fix that, because each layer has one job:

1. **Devices of one role look alike.** Every rack switch has the same uplinks, VLANs, and logins. In Circuit they share one [part](/guide/parts), and differ only in their ports.
2. **Each layer grows on its own.** A new rack gets a new access switch and two cables up. Nothing changes in the layers over it, except two ports.
3. **A failure stays inside its layer.** With devices in pairs at every layer over the racks, one can fail without cutting anything off.
4. **Traffic takes known paths.** It goes up from the access layer, across the middle, and back down, or out through the edge.

## The roles, from the outside in

| Role        | Also called                   | What it does                                                         | What plugs into it                                      |
| ----------- | ----------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------- |
| Edge        | Border                        | Joins your network to others, and runs the BGP sessions and policies | Transit providers, exchanges, links to your other sites |
| Core        | Backbone                      | Carries traffic between the parts of the network as fast as it can   | The edge over it, and aggregation or access under it    |
| Aggregation | Distribution                  | Gathers many access switches, and often routes between their VLANs   | The core over it, and access switches under it          |
| Access      | Top of rack, in a data center | Where hosts plug in                                                  | Servers, desks, access points                           |

The <Term means="The router where your network meets other networks: transit providers, exchanges, and peers. Also called a border router.">edge router</Term> faces outward, and every lesson of Intermediate was about it.

**Core** means two things, and a provider meets both. Inside one site, it is the middle switch, or pair of switches, that the rest of the site hangs from. Across a whole provider network, it is the backbone. This is the routers and long links that join the provider's <Term means="Point of presence: a place, usually a rack or a room in a data center, where a network has equipment and others connect to it.">points of presence</Term> to each other, with no customer plugged into them. The standard for provider VPNs calls those **P routers**. It calls the routers that customers plug into **PE routers**, for provider edge.

The **aggregation** layer exists because a core switch has only so many ports. When a site has dozens of access switches, they join aggregation switches first, and only those join the core. A small site has nothing to aggregate, so one pair of switches does both jobs. That is called a <Term means="A design in which the core and the aggregation layer are the same switches, because the site is too small to need both.">collapsed core</Term>.

**Access** is the bottom layer, where hosts plug in. In a data center the access switch sits at the top of each rack, so it is called a <Term means="A switch at the top of a rack of servers. Every server in the rack is cabled to it, and it has a few uplinks to the next layer. ToR for short.">top-of-rack switch</Term>, or ToR.

<TryIt title="Give each device of a provider its role">

These are the ten devices of a small provider with two sites.

<RolePlacer />

</TryIt>

The roles came from what was plugged in, not from the device's model or size. The two edge routers at site A are the same model as the one at site B, and so are several of the switches.

The middle switches of both sites take two answers. Site A has a pair in the middle, and every rack switch hangs from both. They sit in the OSPF backbone area with the edge routers, so this network calls them `core-a1` and `core-a2`. Site B has one switch that gathers an office and one rack, in an OSPF area of its own, so this network calls it `agg-b1`. Both are collapsed cores.

<Quiz
  question="A switch at a site has a trunk up to the edge router, the office printers and phones, and a cable down to the one rack switch at the site. Which role is it?"
  :choices="['Edge, because it has a trunk to the edge router', 'A collapsed core: the middle of the site, doing the work of core and aggregation', 'Access, because printers plug into it']"
  :answer="1"
  :why="['The edge router is the one with links to other networks. A trunk up to it makes this switch the layer under the edge, not the edge.', '', 'Printers plug into it, but so does another switch. A device that other switches hang from is more than the access layer.']"
  explain="It is the middle of the site: the edge is over it and a rack switch hangs under it. At a site this small, one switch does the work of both core and aggregation, which is a collapsed core."
/>

## Names that say the role and the place

A device's name shows up everywhere. You see it in the prompt when you log in, in every log line it sends, and in the graphs of your monitoring. The devices around it see it too, because <Term means="Link Layer Discovery Protocol: each device tells the device at the other end of each cable its own name and the port the cable is on.">LLDP</Term> tells each neighbor the device's name. A name that says the role and the place answers the first question of every incident, "where is this?", before anyone opens a drawing.

The network in the widget uses one rule for all ten devices: **role, a hyphen, the site's letter, and a number**.

| Part   | In `tor-a3` | Says                                |
| ------ | ----------- | ----------------------------------- |
| Role   | `tor`       | A top-of-rack switch                |
| Site   | `a`         | At site A                           |
| Number | `3`         | The third device of that role there |

A few rules keep a naming scheme working for years:

1. **Use only lowercase letters, digits, and hyphens.** A hostname may use only these characters. Names compare without regard to case, so lowercase avoids two spellings of one name.
2. **Name the role and the place, nothing that changes.** A device's model, its owner, or the customer it serves change over its life, but its role and site rarely do. A name written into fifty files and every log shouldn't need to change when a customer leaves.
3. **Number within the role and the site.** The pair is `edge-a1` and `edge-a2`, so the twin of a device is easy to guess, and a third one is `edge-a3`.
4. **Keep it short.** You type it in commands and read it in narrow columns.
5. **Write the rule down once,** so the next person names the next device the same way.

<Quiz
  question="A new rack switch at site A serves one big customer, Terramix. Which name follows these rules best?"
  :choices="['tor-a4', 'Terramix-Switch', 'tor-a4-terramix']"
  :answer="0"
  :why="['', 'It has the customer in it, who may leave, but not the role or the site. The capital letters also make two spellings possible.', 'The customer may leave while the switch stays. Write the customer in the port descriptions instead.']"
  explain="tor-a4 says the role and the place, and nothing that changes. The customer goes in the description of the ports it uses, where it can change without renaming the device."
/>

## Inside a data center: leaf and spine

The layers so far form a tree. Each access switch has uplinks to its aggregation pair, and each aggregation pair to the core. A tree has two weaknesses in a large data center:

- Traffic between two racks under different aggregation switches has to climb to the core and back down.
- To add racks, the switches near the top need more ports, until bigger switches must replace them.

Large data centers use a <Term means="A network of switches in two layers. Every switch in the lower layer, a leaf, has a link to every switch in the upper layer, a spine. Also called a Clos network.">leaf-spine</Term> <Term means="The switches of a data center or an exchange, and the links between them, built to work as one network.">fabric</Term> instead. The leaves are the top-of-rack switches, and every leaf has one link to every spine. No leaf is joined to another leaf, and no spine to another spine.

<TryIt title="Build a fabric, send flows, and fail a spine">

<LeafSpine />

</TryIt>

What you saw follows from the cabling:

- **Every pair of racks is three switches apart**: leaf, spine, leaf. No path is longer than another.
- **There are as many equal paths between two racks as there are spines.** Each leaf shares <Term means="The packets of one conversation, such as one download: the same source and destination addresses, ports, and protocol.">flows</Term> over all of them with <Term means="Equal-cost multipath: when several paths cost the same, the router shares traffic across all of them.">ECMP</Term>. A router picks the path for a packet from the fields that tell its flow apart, such as its addresses. So the packets of one flow keep to one spine and arrive in order, while different flows spread out.
- **A failed spine takes away a share of the capacity, not the connection.** The leaves stop using it, and nothing else has to change.
- **The fabric grows sideways.** A new rack is one more leaf, and one cable to each spine. Each spine needs one port per leaf, so the ports on a spine set how many racks the fabric can hold. More capacity between racks means one more spine.

<Quiz
  question="A fabric has 4 spines and 20 leaves. One spine fails. What happens to traffic between two racks?"
  :choices="['It stops until the spine is replaced', 'It carries on over the other 3 spines, with three quarters of the capacity', 'It carries on, but now crosses five switches instead of three']"
  :answer="1"
  :why="['Every leaf has a link to every spine, so three ways remain between any two racks.', '', 'The path is still leaf, spine, leaf. Only the number of spines to choose from drops.']"
  explain="Each leaf has 4 equal paths to every other rack, one per spine. Losing a spine removes one of them, so flows spread over the other 3, and 3 of 4 is three quarters of the capacity."
/>

The provider in the widget isn't a data center, so its sites are trees, the right shape at that size. A leaf-spine fabric starts to pay off when there are more racks than a core pair has ports for. It also pays off when most traffic goes from rack to rack, rather than out to the internet.

## Roles in a Circuit project

A device's `role` is free text, such as `Top-of-rack switch`. Circuit only passes it to NetBox, as the device's role there. The role shows in the device's name, in where its file lives, and in what it shares with devices like it. A larger network keeps each site's devices in a folder of their own:

```text
circuit.ts               the AS, address space, sites, and checks
sites/site-a/site.ts     what the site's devices share: VLANs, addresses
sites/site-a/edge-a1.ts  edge-a2.ts
sites/site-a/core-a1.ts  core-a2.ts
sites/site-a/tor-a1.ts   tor-a2.ts   tor-a3.ts
sites/site-b/edge-b1.ts  agg-b1.ts   tor-b1.ts
```

Each device file gives the device its name. Every cable uses that name to say which device is at its far end:

```ts
// sites/site-a/tor-a1.ts
import { as64500 } from "../../circuit";

export default as64500.device({
    name: "tor-a1",
    site: "site-a",
    role: "Top-of-rack switch",
    platform: "vrp",
    model: "CE6855-48S6Q-HI",
    connection: { host: "10.0.99.6", user: "operator" },
    system: {
        users: { operator: { role: "admin", password: secret("TOR_A1_PASSWORD") } },
    },

    // ...

    interfaces: {
        ethernet: {
            "40g-1": { description: "core-a1 40GE1/0/2", trunk_vlans: ["mgmt"], link: { device: "core-a1", port: "40g-2" } },
            "40g-2": { description: "core-a2 40GE1/0/2", trunk_vlans: ["mgmt"], link: { device: "core-a2", port: "40g-2" } },
        },
    },
    switching: {
        vlans: { mgmt: { id: 99, description: "Management" } },
    },
});
```

`circuit validate` checks that each `link` points to a device in the network, and that the far end links back. It also checks that both ends carry the same VLANs. Studio draws its cables from these links. What every switch shares, such as its logins, can be written once as a [part](/guide/parts) that each switch takes with `include`.

## Further reading

- [RFC 7938](https://www.rfc-editor.org/rfc/rfc7938.html), on BGP in large data centers: tree designs compared with leaf-spine designs, ECMP across the spines, and what a failed spine does.
- [The hierarchical network model](https://en.wikipedia.org/wiki/Hierarchical_internetworking_model), on Wikipedia: the core, distribution, and access layers.
- [RFC 4364, section 1.2](https://www.rfc-editor.org/rfc/rfc4364.html#section-1.2), where P, PE, and CE routers are defined.
- [RFC 952](https://www.rfc-editor.org/rfc/rfc952.html) and [RFC 1123, section 2.1](https://www.rfc-editor.org/rfc/rfc1123.html#section-2.1): which characters a hostname may use.
- [Link Layer Discovery Protocol](https://en.wikipedia.org/wiki/Link_Layer_Discovery_Protocol), on Wikipedia: what a device tells its neighbors, its system name included.
- [RFC 2992](https://www.rfc-editor.org/rfc/rfc2992.html), on choosing the path by hashing the fields of a flow.
