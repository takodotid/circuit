---
title: Who runs the internet
description: The kinds of networks a page load crosses, where they meet, and where addresses and AS numbers come from. Follow three page loads hop by hop.
---

# Who runs the internet

Nobody runs the internet as a whole. A single page load crosses several networks, each run by a different organisation for its own reasons: your access provider, an internet exchange, a transit network, a content network, and the hosting company at the end. They meet in data centres, joined by cables the building runs between them. And the addresses and AS numbers they all use are handed out by a small chain of registries, from IANA down to the national registries.

## The kinds of networks

[Networks of networks](/academy/intermediate/autonomous-systems) showed transit and peering between ASes. In the industry, those ASes come in a few kinds:

- **Access providers** sell to homes and businesses: the broadband and DIA of [What an ISP sells](/academy/professional/internet-products).
- **Transit networks** sell transit to other networks, across countries and continents. Hurricane Electric, AS6939, sells transit around the world, and its peering policy offers to peer with networks that meet it at an exchange. RETN, AS9002, an independent network that joins Europe and Asia on one backbone, sells transit and high-capacity links.
- **Content networks** serve what people watch and read: video, software, cloud services. Some of them give access providers servers to put inside their own networks, so the most watched content is served from close by.
- **Hosting companies** run the servers that websites live on, in data centres.

Each network calls the one it buys transit from its <Term means="The network you buy transit from: your way to the rest of the internet.">upstream</Term>, and the networks that buy transit from it its downstreams.

A small group of very large networks reach every other network without buying transit from anyone, by peering with each other. They are called Tier 1 networks, but no authority defines the term, and lists of who counts differ. Hurricane Electric, for example, is very large and peers widely, but buys transit to reach a few networks, so it is usually not counted.

### Exchanges, national and regional

An [internet exchange](/academy/intermediate/autonomous-systems#internet-exchanges) lets its members peer over one shared network. Many countries have a national exchange that keeps traffic between local networks inside the country. In Indonesia, IIX, the Indonesia Internet Exchange, is run in Jakarta by APJII, the association of Indonesian internet providers, for every internet provider licensed in Indonesia, and open to content networks and data centres. Regional exchanges bring together networks from several countries.

<TryIt title="Follow a page load">

Open each of the three, and step along the way your request travels. Each hop says what it is and who runs it.

<PageLoadNetworks />

</TryIt>

The three loads cross very different numbers of networks. The video never left your provider. The local news site crossed one exchange and nothing you or the site pay transit for. Only the site in Europe needed your provider's upstream, and took the long way around the world, where most of its delay comes from.

<Quiz
  question="You watch a video that a content network serves from a cache inside your provider's PoP. Which networks does it cross?"
  :choices="['Only your provider', 'Your provider, the national exchange and the content network', 'Your provider, its upstream and the content network']"
  :answer="0"
  :why="['', 'The cache sits inside your provider, so the video never reaches the exchange.', 'Nothing about it needs transit: the content network put its server inside your provider.']"
  explain="The content network put its own server inside your provider's network, filled with copies of its videos. The video comes from there, and crosses no other network."
/>

## Where networks meet: PoPs, data centres and cross-connects

A network meets others at a <Term means="Point of presence: a place where a network has equipment and can hand over a connection, often a data centre.">PoP</Term>, a point of presence: a building where it has routers and can hand over a connection. Many PoPs are in **data centres**, where other networks already are. A colocation data centre rents space, power and cooling, by the rack or the cage, to many networks at once.

Two networks in the same data centre still need a cable between them, and they cannot run it themselves through the building. They order a <Term means="A cable a data centre runs between two of its customers, through its meet-me room.">cross-connect</Term> from the data centre operator: each has a patch from its cage to the <Term means="The room in a data centre where the cables of every network meet, so the operator can join any two of them.">meet-me room</Term>, and the operator joins the two there. The same cable joins a network to an exchange's switch, or to a transit provider's router in the same building. This is why networks gather in a few well-connected buildings: once you are in, a new peer or a new upstream is a cross-connect away, with no cable to lay across the city.

<Quiz
  question="Your router is in a data centre, and you sign up with a transit provider whose router is in the same building. How are the two joined?"
  :choices="['You run a cable between the two cages yourself', 'You order a cross-connect from the data centre operator', 'The transit provider lays a fibre to your office']"
  :answer="1"
  :why="['Only the data centre operator runs cables between customers, through its meet-me room.', '', 'Your router is already in the building. Nothing needs to reach your office.']"
  explain="A cross-connect is the data centre operator joining two customers through its meet-me room. It is how you reach anyone else in the same building."
/>

## Where addresses and AS numbers come from

Every address and AS number must belong to one network at a time, and be recorded, so that routes can be trusted and the internet's routing tables stay small. A chain of registries keeps this so:

1. **IANA**, the Internet Assigned Numbers Authority, holds the whole pool, and gives large blocks to five regional registries.
2. **Five regional registries**, the <Term means="Regional internet registry: one of five organisations that hand out addresses and AS numbers for a part of the world. APNIC is the one for Asia and the Pacific.">RIRs</Term>, each serve a part of the world: AFRINIC for Africa, APNIC for Asia and the Pacific, ARIN for North America, LACNIC for Latin America and the Caribbean, and the RIPE NCC for Europe, the Middle East and Central Asia.
3. **National registries**, the <Term means="National internet registry: an organisation that hands out addresses and AS numbers in one country, under its regional registry's policies, such as IDNIC in Indonesia.">NIRs</Term>, exist in a few countries. In APNIC's region there are seven: in Indonesia, China, India, Japan, South Korea, Taiwan and Vietnam. Indonesia's is IDNIC, run by APJII.
4. **Providers** that hold blocks hand smaller pieces to their customers.

A network in Indonesia can get its own AS number and addresses from IDNIC or from APNIC. In most cases it chooses one of the two, and cannot get number resources from both. A network in Singapore, which has no national registry, goes to APNIC.

<TryIt title="Who do you ask?">

A network needs many things from many organisations. For each need, pick who provides it.

<WhoToAsk />

</TryIt>

## Your PeeringDB record, written in Circuit

Before peering with you, other networks look you up on [PeeringDB](https://www.peeringdb.com), to see which exchanges and buildings you are at. In Circuit, an interface on an exchange's peering LAN says which exchange it is, with `exchange`. Devices ignore it:

```ts
interfaces: {
    ix: {
        type: "vlan",
        vlan: "ix",
        addresses: ["203.0.113.140/25", "2001:db8:ffff::70/64"],
        exchange: { name: "Example IX", speed: 10_000 },
    },
},
```

With your AS number and a PeeringDB key in `circuit.config.ts`, `npx circuit peeringdb` compares each such interface with your record and prints what differs, and `npx circuit peeringdb --confirm` sends the changes. An exchange PeeringDB lists and your files do not is reported, never deleted. [Publishing the network](/guide/publishing) shows the whole setup.

## Further reading

- [Hurricane Electric's peering policy](https://he.net/peering.html), and its records on PeeringDB for [AS6939](https://www.peeringdb.com/net/291) and RETN's [AS9002](https://www.peeringdb.com/asn/9002).
- [RETN](https://retn.net/): an independent transit network joining Europe and Asia.
- [Tier 1 network](https://en.wikipedia.org/wiki/Tier_1_network): what the term means, and why nobody defines it.
- [IIX-Jakarta](https://www.peeringdb.com/ix/210) on PeeringDB: the Indonesia Internet Exchange, run by APJII.
- [Netflix Open Connect](https://openconnect.netflix.com/en/): a content network's servers inside providers' networks, and its open peering at exchanges.
- [Point of presence](https://en.wikipedia.org/wiki/Point_of_presence) and [Meet-me room](https://en.wikipedia.org/wiki/Meet-me_room): where networks meet, and how a cross-connect is made.
- [IANA: Number resources](https://www.iana.org/numbers) and [RFC 7020](https://www.rfc-editor.org/rfc/rfc7020): the registries, from IANA down.
- [National Internet Registries](https://www.apnic.net/about-apnic/organization/apnic-region/national-internet-registries), APNIC: the seven NIRs, and the choice between an NIR and APNIC.
- [IDNIC](https://idnic.net/): Indonesia's national internet registry.
- [Submarine cable FAQs](https://www2.telegeography.com/submarine-cable-faqs-frequently-asked-questions), TeleGeography: the cables between continents.

## In short

- A page load crosses access providers, exchanges, transit networks, content networks and hosting companies, each run by a different organisation.
- Transit networks such as Hurricane Electric and RETN sell a way across the world; national exchanges such as IIX keep local traffic local.
- Networks meet at PoPs in data centres, joined by cross-connects the operator runs through its meet-me room.
- Addresses and AS numbers flow from IANA to five regional registries such as APNIC, then through national registries such as IDNIC, to networks.
- In Circuit, `exchange` on an interface keeps your PeeringDB record matching your files.
