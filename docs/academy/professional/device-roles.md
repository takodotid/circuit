---
title: Roles in a network
description: Lay a network out in layers, from the edge through the core to the racks, and give each device a name that says its role and its place.
---

# Roles in a network

A network bigger than one room is laid out in layers, and every device in it has one role. The **edge** joins your network to other networks. The **core** is the middle that everything else hangs from. **Aggregation** gathers many access switches together, and **access** is where servers and desks plug in. In a data centre, the access and aggregation layers are often replaced by a **leaf-spine** <Term means="The switches of a data centre and the links between them, built so that every rack reaches every other rack the same way.">fabric</Term> of top-of-rack switches.

Once every device has a role, it can have a name that says the role and the place, such as `edge-a1`: the first edge router at site A. Anyone who reads that name in a log, a graph or a Circuit file knows where to look.

## Why lay a network out by role

A network that grew one device at a time, each plugged in where there was a free port, works until something breaks. Then nobody can say which way traffic goes, which device a failure takes down with it, or what a new device should look like.

Roles fix that, because each layer has one job:

1. **Devices of one role look alike.** Every rack switch has the same uplinks, VLANs and logins, so in Circuit they share one file of settings and differ only in their ports. In the regional provider example that file is `switches.ts`, and the edge routers share `edge.ts`.
2. **Each layer grows on its own.** A new rack gets a new access switch and two cables up. Nothing above it changes beyond two ports.
3. **A failure stays inside its layer.** With devices in pairs at every layer above the racks, one can fail without cutting anything off.
4. **Traffic takes known paths.** Up from the access layer, across the middle, and back down, or out through the edge.

## The roles, from the outside in

| Role        | Also called                   | What it does                                                         | What plugs into it                                      |
| ----------- | ----------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------- |
| Edge        | border                        | Joins your network to others, runs the BGP sessions and the policies | Transit providers, exchanges, links to your other sites |
| Core        | backbone                      | Carries traffic between the parts of the network as fast as it can   | The edge above, aggregation or access below             |
| Aggregation | distribution                  | Gathers many access switches, and often routes between their VLANs   | The core above, access switches below                   |
| Access      | top of rack, in a data centre | Where hosts plug in                                                  | Servers, desks, access points                           |

The <Term means="The router where your network meets other networks: transit providers, exchanges and peers. Also called a border router.">edge router</Term> is the one that faces outward, and every lesson of Intermediate was about it. Whether a network calls it edge or border, it keeps the word for that one role.

**Core** means two things, and a provider meets both. Inside one site, it is the middle switch or pair of switches that the rest of the site hangs from. Across a whole provider network, it is the backbone: the routers and long links that join the provider's <Term means="Point of presence: a place, usually a rack or a room in a data centre, where a provider has equipment and customers or other networks connect to it.">points of presence</Term> to each other, with no customer plugged into them. The standard for provider VPNs calls those **P routers**, and the routers customers plug into **PE routers**, for provider edge.

The **aggregation** layer exists because a core switch has only so many ports. When a site has dozens of access switches, they are joined to aggregation switches first, and only those join the core. In a small site there is nothing to aggregate, so one pair of switches does both jobs. That is called a <Term means="A design in which the core and the aggregation layer are the same switches, because the site is too small to need both.">collapsed core</Term>.

**Access** is the bottom layer, where hosts plug in. In a data centre the access switch sits at the top of each rack, so it is called a <Term means="ToR: a switch at the top of a rack of servers, with every server in the rack cabled to it and a few uplinks to the layer above.">top-of-rack switch</Term>, ToR for short.

<TryIt title="Give each device of a provider its role">

These are the ten devices of Circuit's regional provider example, a small provider with two sites. Read what is plugged into each one, then give it a role. Watch the drawing fill in, and the name and file each device gets.

<RolePlacer />

</TryIt>

The roles came from what was plugged in, not from the device's model or how big it is. The two edge routers at site A are the same model as the one at site B, and so are several of the switches. A device's role is the job it does in your drawing.

You may also have found that the middle switches of both sites accept two answers. Site A has a pair in the middle, every rack switch hangs from both, and they sit in OSPF's backbone area with the edge routers; the example calls them `core-a1` and `core-a2`. Site B has one switch that gathers an office and one rack, in an OSPF area of its own; the example calls it `agg-b1`. Both are collapsed cores, and either name works if every site is named by one rule.

<Quiz
  question="A switch at a site has a trunk up to the edge router, the office printers and phones, and a cable down to the one rack switch at the site. Which role is it?"
  :choices="['Edge, because it has a trunk to the edge router', 'A collapsed core: the middle of the site, doing the work of core and aggregation', 'Access, because printers plug into it']"
  :answer="1"
  :why="['The edge router is the one with links to other networks. A trunk up to it makes this switch the layer below the edge, not the edge.', '', 'Printers plug into it, but so does another switch. A device that other switches hang from is more than the access layer.']"
  explain="It is the middle of the site: the edge is above it and a rack switch hangs below it. At a site this small, one switch does the work of both core and aggregation, which is a collapsed core."
/>

## Names that say the role and the place

A device's name shows up everywhere: in the prompt when you log in, in every log line it sends, in the graphs of your monitoring, and in the neighbour lists of the devices around it, since <Term means="Link Layer Discovery Protocol: each device tells the devices on its cables its own name and the port the cable is on.">LLDP</Term> tells each neighbour the device's name. A name that says the role and the place answers the first question of every incident, where is this, before anyone opens a drawing.

The regional provider example uses one rule for all ten devices: **role, a hyphen, the site's letter, and a number**.

| Part   | In `tor-a3` | Says                                |
| ------ | ----------- | ----------------------------------- |
| Role   | `tor`       | A top-of-rack switch                |
| Site   | `a`         | At site A                           |
| Number | `3`         | The third device of that role there |

A few rules keep a naming scheme working for years:

1. **Use only lowercase letters, digits and hyphens.** Those are the characters a hostname may use, and names compare without regard to case, so lowercase avoids two spellings of one name.
2. **Name the role and the place, nothing that changes.** A device's model, its owner's name or the customer it serves change over its life; its role and site rarely do. A name written into fifty files and every log should not need to change when a customer leaves.
3. **Number within the role and the site.** The pair is `edge-a1` and `edge-a2`, so the twin of a device is easy to guess, and a third one is `edge-a3`.
4. **Keep it short.** You type it in commands and read it in narrow columns.
5. **Write the rule down once,** so the next person names the next device the same way.

<Quiz
  question="A new rack switch at site A will serve one big customer, Example Corp. Which name follows the rules above best?"
  :choices="['tor-a4', 'ExampleCorp-Switch', 'tor-a4-examplecorp']"
  :answer="0"
  :why="['', 'It has the customer in it, who may leave, but not the role or the site. The capital letters also make two spellings possible.', 'The customer may leave while the switch stays. Write the customer in the port descriptions instead.']"
  explain="tor-a4 says the role and the place, and nothing that will change. The customer goes in the description of the ports it uses, where it can change without renaming the device."
/>

## Inside a data centre: leaf and spine

The layers above form a tree: each access switch has uplinks to its aggregation pair, each aggregation pair to the core. A tree has two weaknesses in a large data centre. Traffic between two racks under different aggregation switches has to climb to the core and back down. And to add racks, the switches near the top need more ports, until they must be replaced by bigger ones.

Large data centres use a <Term means="A network of switches in two layers, in which every switch of the lower layer, the leaves, has a link to every switch of the upper layer, the spines. Also called a Clos network.">leaf-spine</Term> design instead. The <Term means="A switch in the lower layer of a leaf-spine network. Servers plug into it, and it has one uplink to every spine.">leaves</Term> are the top-of-rack switches, and every leaf has one link to every <Term means="A switch in the upper layer of a leaf-spine network. It has a link to every leaf and nothing else.">spine</Term>. No leaf is joined to another leaf, and no spine to another spine.

<TryIt title="Build a fabric, send flows, and fail a spine">

Choose how many spines and leaves to build. Send a flow from one rack to another, then send a few more, and watch which spine each one takes. Then fail a spine.

<LeafSpine />

</TryIt>

What you saw follows from the cabling:

- **Every pair of racks is three switches apart**: leaf, spine, leaf. No path is longer than another.
- **There are as many equal paths between two racks as there are spines.** Each leaf shares <Term means="The packets of one conversation, such as one download: same source and destination addresses and ports.">flows</Term> over all of them with <Term means="Equal-cost multipath: when several paths cost the same, the router sends traffic over all of them, so it is shared.">ECMP</Term>. A router picks the path for a packet from the fields that identify its flow, such as its addresses, so the packets of one flow keep to one spine and are not reordered on different paths, while different flows spread out.
- **A failed spine takes away a share of the capacity, not the connection.** With four spines, losing one leaves three quarters. The leaves stop using it, and nothing else has to change.
- **The fabric grows sideways.** A new rack is one more leaf and one cable to each spine. Each spine needs one port per leaf, so the number of ports on a spine sets how many racks the fabric can hold; more capacity between racks means one more spine.

<Quiz
  question="A fabric has 4 spines and 20 leaves. One spine fails. What happens to traffic between two racks?"
  :choices="['It stops until the spine is replaced', 'It carries on over the other 3 spines, with three quarters of the capacity', 'It carries on, but now crosses five switches instead of three']"
  :answer="1"
  :why="['Every leaf has a link to every spine, so three ways remain between any two racks.', '', 'The path is still leaf, spine, leaf. Only the number of spines to choose from drops.']"
  explain="Each leaf has 4 equal paths to every other rack, one per spine. Losing a spine removes one of them, so flows spread over the other 3, and 3 of 4 is three quarters of the capacity."
/>

The regional provider example is a small provider, not a data centre, so its sites are trees: an edge pair, a core pair, and rack switches below with an uplink to each core switch. That is the right shape at that size. A leaf-spine fabric starts to pay off when there are more racks than a core pair has ports for, or when most traffic goes from rack to rack rather than out to the internet.

## Roles in a Circuit project

Circuit has no field for a role: a device's role is in its name, in where its file lives, and in the shared files it takes its settings from. The regional provider example keeps each site's devices in a directory of their own, and what devices of one role share in a file beside them:

```text
examples/use-cases/regional-provider/
  circuit.config.ts    every device of the network
  network.ts           the AS, address space, sites and exchange
  edge.ts              what the edge routers share: policies, firewall, logins
  switches.ts          what the switches share: logins, VLANs on each trunk
  site-a/
    edge-a1.ts  edge-a2.ts
    core-a1.ts  core-a2.ts
    tor-a1.ts   tor-a2.ts   tor-a3.ts
  site-b/
    edge-b1.ts
    agg-b1.ts
    tor-b1.ts
```

Each device file gives the device its name, and every cable uses that name to say which device is at its far end:

```ts
export default defineDevice({
    name: "tor-a1",
    platform: "vrp",
    model: "CE6855-48S6Q-HI",
    connection: { host: "10.0.99.6", user: "operator" },
    users: switches.users,
    system: switches.system,
    management: switches.vrpManagement("Site A, rack 3"),

    // ...

    ports: Utils.merge(customerPorts(AT.a, "tor-a1", HOST), {
        "40g-1": { description: "core-a1", trunk_vlans: switches.SITE_A_TOR, link: { device: "core-a1", port: "40g-2" } },
        "40g-2": { description: "core-a2", trunk_vlans: switches.SITE_A_TOR, link: { device: "core-a2", port: "40g-2" } },
    }),
});
```

The rack switch takes its logins and services from `switches.ts`, as every switch does, and its two uplinks go to the core pair. `circuit validate` checks that each `link` points to a device in the network, that the far end links back, and that both ends carry the same VLANs. `npx circuit studio` draws its cables layer from these links.

## Further reading

- [RFC 7938: Use of BGP for Routing in Large-Scale Data Centers](https://www.rfc-editor.org/rfc/rfc7938.html), which compares tree designs with Clos (leaf-spine) designs, and describes ECMP across the spines and what a failed spine does.
- [Hierarchical internetworking model](https://en.wikipedia.org/wiki/Hierarchical_internetworking_model), on Wikipedia: the core, distribution and access layers.
- [RFC 4364, section 1.2](https://www.rfc-editor.org/rfc/rfc4364.html#section-1.2), where P, PE and CE routers are defined.
- [RFC 952](https://www.rfc-editor.org/rfc/rfc952.html) and [RFC 1123, section 2.1](https://www.rfc-editor.org/rfc/rfc1123.html#section-2.1): which characters a hostname may use.
- [Link Layer Discovery Protocol](https://en.wikipedia.org/wiki/Link_Layer_Discovery_Protocol), on Wikipedia: what a device tells its neighbours, its system name included.
- [RFC 2992: Analysis of an Equal-Cost Multi-Path Algorithm](https://www.rfc-editor.org/rfc/rfc2992.html), on choosing the path by hashing the fields of a flow.
- [The regional provider example](https://github.com/takodotid/circuit/tree/main/examples/use-cases/regional-provider), the network this lesson lays out.

## In short

- A network is laid out in layers: the edge meets other networks, the core is the middle, aggregation gathers access switches, and access is where hosts plug in. A small site folds core and aggregation into a collapsed core.
- A device's role comes from what plugs into it, not from its model.
- Name devices by role, site and number, as `edge-a1` and `tor-a3`, with lowercase letters, digits and hyphens, and nothing in the name that will change.
- In a leaf-spine fabric every leaf has a link to every spine: any two racks are three switches apart, over as many equal paths as there are spines.
- Circuit has no role field: the role lives in the name, the directory and the shared files, and each link says which device is at its far end.
