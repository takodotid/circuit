---
title: Who runs the internet
description: The kinds of networks a page load crosses, where they meet, and where addresses and AS numbers come from. Follow three page loads hop by hop.
---

# Who runs the internet

Nobody runs the internet as a whole. A single page load crosses several networks, and a different organization runs each one. They meet in data centers, joined by cables the building runs between them. The addresses and AS numbers they all use come from a small chain of registries, from IANA down to the national registries.

## The kinds of networks

[Networks of networks](/academy/intermediate/autonomous-systems) showed transit and peering between ASes. In the industry, those ASes come in a few kinds:

- **Access providers** sell to homes and businesses, such as the broadband and DIA of [What an ISP sells](/academy/professional/internet-products).
- **Transit networks** sell transit to other networks across countries and continents. Hurricane Electric, AS6939, sells transit around the world. Its peering policy offers to peer with networks that meet it at an exchange. Arelion, AS1299, sells transit over one of the largest backbones in the world.
- **Content networks** serve what people watch and read, such as video, software, and cloud services. Some of them give access providers servers to put inside their own networks. Then the most watched content is served from close by.
- **Hosting companies** run the servers that websites live on, in data centers.

The network you buy transit from is your <Term means="The network you buy transit from: your way to the rest of the internet.">upstream</Term>. The networks that buy transit from you are your downstream networks.

A small group of very large networks reach every other network by peering with each other, without buying transit from anyone. They are called Tier 1 networks. No authority defines the term, and lists of who counts differ. Hurricane Electric, for example, is very large and peers widely, but buys transit to reach a few networks. So it is usually not counted.

### National and regional exchanges

An [internet exchange](/academy/intermediate/autonomous-systems#internet-exchanges) lets its members peer over one shared network. Many countries have a national exchange that keeps traffic between local networks inside the country. In Indonesia, APJII, the association of Indonesian internet providers, runs IIX, the Indonesia Internet Exchange, in Jakarta. It serves every internet provider licensed in Indonesia, and it is open to content networks and data centers. Regional exchanges bring together networks from several countries.

<TryIt title="Follow a page load">

Open each of the three, and step along the way your request travels.

<PageLoadNetworks />

</TryIt>

<Quiz
  question="You watch a video that a content network serves from a cache inside your provider's PoP. Which networks does it cross?"
  :choices="['Only your provider', 'Your provider, the national exchange, and the content network', 'Your provider, its upstream, and the content network']"
  :answer="0"
  :why="['', 'The cache sits inside your provider, so the video never reaches the exchange.', 'Nothing about it needs transit: the content network put its server inside your provider.']"
  explain="The content network put its own server inside your provider's network, filled with copies of its videos. The video comes from there, and crosses no other network."
/>

## Where networks meet

A network meets others at a <Term means="Point of presence: a place, usually a rack or a room in a data center, where a network has equipment and others connect to it.">PoP</Term>, a point of presence. Many PoPs are in **data centers**, where other networks already are. A colocation data center rents space, power, and cooling by the rack or the cage, to many networks at once.

Two networks in the same data center still need a cable between them, and they can't run it through the building themselves. They order a <Term means="A cable the data center runs between two customers' racks, or between a customer and a network, in the same building.">cross-connect</Term> from the data center operator. Each network has a cable from its cage to the <Term means="The room in a data center where the cables of every network meet, so the operator can join any two of them.">meet-me room</Term>. The operator joins the two there.

The same kind of cable joins a network to an exchange's switch, or to a transit provider's router in the same building. This is why networks gather in a few well-connected buildings. Once you are in, a new peer or a new upstream is a cross-connect away, with no cable to lay across the city.

<Quiz
  question="Your router is in a data center, and you sign up with a transit provider whose router is in the same building. How are the two joined?"
  :choices="['You run a cable between the two cages yourself', 'You order a cross-connect from the data center operator', 'The transit provider lays a fiber to your office']"
  :answer="1"
  :why="['Only the data center operator runs cables between customers.', '', 'Your router is already in the building. Nothing needs to reach your office.']"
  explain="A cross-connect is a cable the data center operator runs between two customers. It is how you reach anyone else in the same building."
/>

## Where addresses and AS numbers come from

Every address and AS number must belong to one network at a time, and be recorded. This way routes can be trusted, and the routing tables of the internet stay small. A chain of registries makes sure of this:

1. **IANA**, the Internet Assigned Numbers Authority, keeps the whole pool. It gives large blocks to the five regional registries.
2. Five <Term means="Regional internet registry: one of five organizations that hand out addresses and AS numbers for a part of the world. APNIC is the one for Asia and the Pacific.">regional internet registries</Term> each serve a part of the world. [Networks of networks](/academy/intermediate/autonomous-systems#as-numbers-and-address-blocks) lists them. APNIC serves Asia and the Pacific.
3. <Term means="National internet registry: an organization that hands out addresses and AS numbers in one country, under the policies of its RIR, such as IDNIC in Indonesia.">National internet registries</Term> exist in a few countries. The APNIC region has seven, in Indonesia, China, India, Japan, South Korea, Taiwan, and Vietnam. Indonesia's is IDNIC, run by APJII.
4. **Providers** that have blocks hand smaller pieces to their customers.

A network in Indonesia can get its own AS number and addresses from IDNIC or from APNIC. In most cases it chooses one of the two, and can't get number resources from both. A network in Singapore, which has no national registry, goes to APNIC.

<TryIt title="Who do you ask?">

<WhoToAsk />

</TryIt>

## Your PeeringDB record, written in Circuit

Before peering with you, other networks look you up on [PeeringDB](https://www.peeringdb.com) to see which exchanges and buildings you are at. In Circuit, `exchange` on an interface says which exchange the interface is on:

```ts
interfaces: {
    vlan_interface: {
        ix: {
            vlan: "ix",
            addresses: ["203.0.113.140/25", "2001:db8:ffff::70/64"],
            exchange: { name: "DE-CIX Frankfurt", speed: 10_000 },
        },
    },
},
```

Circuit writes nothing to the device for `exchange`. Instead, `circuit sync peeringdb` keeps your PeeringDB record in sync with it, with each presence, its addresses, its speed, and whether you peer with the route servers. See [PeeringDB](/integrations/peeringdb).

## Further reading

- [The peering policy of Hurricane Electric](https://he.net/peering.html), and the PeeringDB records for [AS6939](https://www.peeringdb.com/net/291) and [AS1299](https://www.peeringdb.com/asn/1299).
- [Tier 1 network](https://en.wikipedia.org/wiki/Tier_1_network): what the term means, and why nobody defines it.
- [IIX-Jakarta](https://www.peeringdb.com/ix/210) on PeeringDB: the Indonesia Internet Exchange, run by APJII.
- [Netflix Open Connect](https://openconnect.netflix.com/en/): a content network's servers inside providers' networks, and its open peering at exchanges.
- [Point of presence](https://en.wikipedia.org/wiki/Point_of_presence), and the [meet-me room](https://en.wikipedia.org/wiki/Meet-me_room): where networks meet, and how a cross-connect is made.
- [IANA number resources](https://www.iana.org/numbers) and [RFC 7020](https://www.rfc-editor.org/rfc/rfc7020): the registries, from IANA down.
- [National Internet Registries](https://www.apnic.net/about-apnic/organization/apnic-region/national-internet-registries), APNIC: the seven national registries, and the choice between one of them and APNIC.
- [IDNIC](https://idnic.net/), the national internet registry of Indonesia.
- [Submarine cable FAQs](https://www2.telegeography.com/submarine-cable-faqs-frequently-asked-questions), TeleGeography: the cables between continents.

## In short

- A page load crosses access providers, exchanges, transit networks, content networks, and hosting companies. A different organization runs each one.
- Transit networks such as Hurricane Electric and Arelion sell a way across the world. National exchanges such as IIX keep local traffic local.
- Networks meet at PoPs in data centers, joined by cross-connects that the operator runs.
- Addresses and AS numbers flow from IANA to five regional registries such as APNIC, then through national registries such as IDNIC, to networks.
- In Circuit, `exchange` on an interface keeps your PeeringDB record matching your files.
