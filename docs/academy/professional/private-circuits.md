---
title: Carrying your own traffic
description: Metro-E, EPL and EVPL, IP VPN, IPLC and IEPL, dark fiber, wavelengths, and SD-WAN, told apart. Match each to a need, and hand one over on a port.
---

# Carrying your own traffic

Internet products carry a customer's traffic to the rest of the internet. **Private circuits** carry it between the customer's own sites, such as offices, data centers, and branches abroad, without crossing the internet. A company buys one for a rate it can count on between its sites, for a delay that doesn't change, or to keep its traffic off the internet.

## Choose by what you want to run

The older, general word for all of these is a <Term means="A private circuit rented from a provider between two or more places, always on, and kept for one customer. Metro-E, IEPL, and IPLC are all kinds of leased line.">leased line</Term>. Quotes still use it, sometimes for a line to the internet too. So ask what exactly is carried, and between which two points.

The lower the layer you buy, the more capacity you get, and the more you run yourself:

| You buy                     | The provider carries                 | You run                              | Reach                               |
| --------------------------- | ------------------------------------ | ------------------------------------ | ----------------------------------- |
| Dark fiber                  | Nothing (a bare fiber)               | The optics and everything over them  | Where spare fiber runs              |
| A DWDM wavelength           | Light, at a fixed rate               | Everything over the light            | Point to point, often long distance |
| Metro-E, L2 transport, IEPL | Ethernet frames                      | Addresses and routing                | A city, a country, abroad           |
| IPLC                        | A fixed-rate circuit                 | Addresses and routing                | Between countries                   |
| IP VPN                      | IP packets, routed                   | Only your own sites' routers         | Wherever the provider is            |
| SD-WAN                      | Nothing (it rides on internet links) | The tunnels, or a provider runs them | Wherever there is internet          |

## Ethernet across a city with Metro-E

<Term means="Metro Ethernet: a provider's Ethernet service between sites in one city.">Metro-E</Term> is Ethernet carried across a city by a provider. You plug a router into a port at each office, and the two behave as if a long cable joined them. The industry body MEF defined these services and their names. It is now called Mplify. The common one is the point-to-point line, which comes in two kinds:

- An EPL, Ethernet private line, takes the whole port. Every frame you send on it, tagged with any VLAN or not, arrives at the far end as it left. The provider never looks at your tags.
- An EVPL, Ethernet virtual private line, is chosen by VLAN. One port can carry several EVPL circuits, each a VLAN that goes to a different place, such as VLAN 2010 to the branch and VLAN 2020 to the data center. You agree the VLAN numbers with the provider.

The same Ethernet services between cities are often sold as **L2 transport**, and they come as EPL or EVPL too.

<TryIt title="Hand over circuits on one port">

<EvplHandoff />

</TryIt>

An EPL hands you one link, so in Circuit the port itself is the link and gets the address. An EVPL hands you a trunk. The port carries VLANs, and each VLAN gets an interface with its own address, like the [trunks](/academy/elementary/trunks) you already know. The [colocation example](/guide/examples#colocation-with-tenants) hands tenants their networks the same way, as VLANs on a port.

Each circuit is a small network of two routers, usually a /30 or a /31. You route over it with static routes or OSPF, as between any two of your routers.

<Quiz
  question="Your office router has one free port toward the provider. You need a circuit to the branch office and another to the data center. What do you buy?"
  :choices="['One EPL, which carries everything', 'Two EVPLs on the same port, one VLAN each', 'Two EPLs on the same port']"
  :answer="1"
  :why="['An EPL goes to one far end only. Everything on the port arrives there, so the data center would never see it.', '', 'An EPL takes the whole port. Two of them need two ports.']"
  explain="EVPLs are chosen by VLAN, so one port carries both: one VLAN to the branch, another to the data center."
/>

### Your VLANs inside theirs with QinQ

An EPL carries your frames as they are, with their tags. A provider carries the EPL circuits of many customers across the same switches, and two customers may both use VLAN 20. So the provider can't use your tag to keep you apart. Instead, when your frame enters its network, the provider adds a tag of its own outside yours, and takes it off again at the far end. A frame with two tags, one inside the other, is called <Term means="Two VLAN tags on one frame, one inside the other. The provider's outer tag keeps customers apart, and the customer's own tag rides inside it untouched. The standard is IEEE 802.1ad.">QinQ</Term>, after 802.1Q in 802.1Q.

- The **outer tag**, the service tag or S-tag, is the provider's. It says which customer, or which circuit, the frame is for.
- The **inner tag**, the customer tag or C-tag, is yours. It is the ordinary 802.1Q tag from [Trunks](/academy/elementary/trunks), carried across untouched.

So you keep your own VLAN numbers end to end, and they never clash with another customer's. The cost is size. Each tag adds 4 bytes to the frame, so the provider's links must carry frames a little larger than yours. This is the same [MTU](/academy/beginner/cables) question as for any tunnel.

You don't write QinQ in your own files. At your port you send and receive ordinary frames, tagged or not, and the provider adds and removes its outer tag. Circuit has no field for an outer tag today, so it can write your side of such a circuit, but not the provider's.

## Routed for you with an IP VPN

With an <Term means="A provider joining a customer's sites into one private routed network. The customer's routers tell the provider their routes, and the provider routes between the sites.">IP VPN</Term>, the provider does the routing. The standard calls your router at each site the customer edge, and the provider's router the provider edge. Your router tells the provider's router which addresses are behind it, over BGP, OSPF, or static routes.

The provider then carries packets between all your sites, from any site to any other. It keeps your routes apart from every other customer's, even if you both use the same private addresses. The standard for it is RFC 4364, often called MPLS L3VPN after the technology providers build it with. [Separate networks on one](/academy/professional/vrfs-and-overlays) shows how a provider keeps customers apart inside.

An IP VPN fits a company with many sites that must all reach each other, and that doesn't want to run the routing between them.

## Between countries with IPLC and IEPL

An IPLC, international private leased circuit, is a dedicated line between two sites in different countries. Its fixed capacity is reserved for the customer alone. It was first built on SONET and SDH, the older circuit technologies of telephone networks. It may be handed over on an interface that isn't Ethernet.

An IEPL, international Ethernet private line, is the same idea handed over as Ethernet, so it plugs into an ordinary router or switch port. Both are point to point. For many sites in many countries, an IP VPN usually fits better.

## Light itself: dark fiber and wavelengths

<Term means="A fiber already in the ground or on poles, rented with no equipment at either end. The customer lights it with its own optics.">Dark fiber</Term> is a fiber already in the ground, rented with nothing on it. You put your own optics at both ends, and run it at whatever speed they support. When you need more, you change the optics. It is rented where spare fiber already runs. Most spare fiber is in cities and between data centers. It is often rented for a long term, under a contract called an <Term means="Indefeasible right of use: a long contract that gives the right to use a fiber, or capacity on it, and cannot be taken back.">IRU</Term>. The fiber is the provider's, and everything that lights it is yours, faults included.

One fiber can carry many links at once, each on its own wavelength, its own color of light. This is <Term means="Wavelength division multiplexing: sending several links down one fiber at once, each on its own wavelength of light.">WDM</Term>, wavelength division multiplexing. It comes in two common kinds:

- **CWDM**, coarse WDM, spaces its colors widely, with up to 18 channels 20 nanometers apart, from 1,270 to 1,610 nanometers (ITU-T G.694.2). The wide gaps let the optics be simple and cheap. But the light can't be amplified on the way, so CWDM suits distances across a city, a few tens of kilometers.
- **DWDM**, dense WDM, packs its colors tightly, with 40 channels 100 GHz apart, or 80 channels 50 GHz apart, on the ITU-T G.694.1 grid. They sit in the band that optical amplifiers work in. So a DWDM line can run between cities and across countries, with an amplifier every 80 to 100 km.

So CWDM gets more out of your own dark fiber across a city, and long fiber routes run on DWDM. A provider with DWDM on its fiber can sell one **wavelength**. It is a link at a fixed rate, such as 10 or 100 Gbit/s, that carries whatever you send on it. You get a whole link's capacity without lighting the fiber yourself, and other customers ride other colors on the same fiber.

## Over the internet with SD-WAN

<Term means="Software-defined WAN: encrypted tunnels between a company's sites over the links it already has, mostly internet. Each kind of traffic is sent the best way, and everything is managed from one place.">SD-WAN</Term> joins sites with tunnels over the links they already have, such as broadband, DIA, or an IP VPN. The MEF defines it as a service that encrypts traffic between its edges, and sorts that traffic into flows by app. It then sends each flow over the link its policy picks, such as video calls over the steadiest link and backups over the cheapest. The company runs it from one place, or a provider sells it as a service.

It costs far less than a private circuit to every site, and a site with two internet links survives one failing. But nothing under it is committed: the delay and the loss are whatever the internet gives that day. So it suits small sites well. A site that needs a promise keeps a private circuit or an IP VPN, which SD-WAN can then use as one of its links.

<TryIt title="Match the product to the need">

<CircuitScenarios />

</TryIt>

Most needs have more than one answer. Distance rules out the rest. Metro-E stays in a city, IPLC and IEPL cross borders, and dark fiber goes only where spare fiber already runs.

<Quiz
  question="Two data centers 30 km apart copy 100 Gbit/s of storage between them, and the team does not want to run optical equipment. What fits?"
  :choices="['A DWDM wavelength from a provider', 'Dark fiber', 'An IP VPN']"
  :answer="0"
  :why="['', 'Dark fiber fits the capacity, but someone must light it: the optics and any DWDM equipment are yours to run.', 'An IP VPN joins sites by routing for them. It is not a pipe for 100 Gbit/s of steady copies.']"
  explain="A wavelength gives a whole 100 Gbit/s link between the two sites, and the provider runs the DWDM equipment. Buy a second wavelength when the copies grow."
/>

<Quiz
  question="Forty shops each have an ordinary broadband line, and need to reach the head office cheaply. Where does SD-WAN fit?"
  :choices="['It replaces the broadband lines', 'It builds encrypted tunnels over the broadband lines the shops already have', 'It needs a private circuit to every shop first']"
  :answer="1"
  :why="['SD-WAN needs links under it. It does not carry anything by itself.', '', 'It can use private circuits, but it does not need them. Running over broadband is what makes it cheap.']"
  explain="SD-WAN rides on the links a site already has. Over broadband it costs little, though nothing under it commits to a rate or a delay."
/>

## Further reading

- [Carrier Ethernet](https://en.wikipedia.org/wiki/Carrier_Ethernet): E-Line, EPL, and EVPL as the MEF defines them.
- [RFC 6004](https://www.rfc-editor.org/rfc/rfc6004.html): an EPL is port-based, and an EVPL is one of several circuits on a port, chosen by VLAN.
- [IEEE 802.1ad](https://en.wikipedia.org/wiki/IEEE_802.1ad): the provider's service tag outside the customer's tag, each tag 4 bytes.
- [Metro Ethernet](https://en.wikipedia.org/wiki/Metro_Ethernet): what Ethernet services across a city are.
- [From MEF to Mplify](https://www.mplify.net/edge-view-blog/from-mef-to-mplify-a-new-name-for-a-new-era/): the new name of the MEF.
- [RFC 4364](https://www.rfc-editor.org/rfc/rfc4364): BGP/MPLS IP VPNs, the customer edge, and the provider edge.
- [What is IPLC](https://www.iptp.net/what-is-iplc/), IPTP Networks: a dedicated circuit between countries, compared with MPLS VPNs.
- [What are the differences between IEPL and IPLC](https://www.simcentric.com/hong-kong-dedicated-server/what-are-the-differences-between-iepl-and-iplc/): an Ethernet line compared with a fixed circuit.
- [Dark fiber](https://en.wikipedia.org/wiki/Dark_fibre), [dark fiber](https://www.lexisnexis.com/en-gb/legal/glossary/dark-fibre) in the LexisNexis glossary, and [Indefeasible rights of use](https://en.wikipedia.org/wiki/Indefeasible_rights_of_use).
- [Leased line](https://en.wikipedia.org/wiki/Leased_line): a private circuit between two or more places, kept for one customer.
- [Wavelength-division multiplexing](https://en.wikipedia.org/wiki/Wavelength-division_multiplexing): the CWDM and DWDM grids, and why only DWDM is amplified.
- [Wavelengths](https://arelion.com/products-and-services/networking/wavelengths), Arelion: a wavelength service as a transit provider sells it.
- [MEF 70 SD-WAN Service Attributes and Services](https://www.lightwaveonline.com/network-automation/article/14038725/mef-releases-mef-70-sd-wan-service-attributes-and-services-standard), and the [MEF 3.0 SD-WAN Services](https://www.mplify.net/wp-content/uploads/2019/11/MEF-Presentation-WS-Vid-MEF-3-0-SD-WAN-Services.pdf) presentation: flows, policies, encryption between edges, and the links under them.

## In short

- Private circuits carry a company's traffic between its own sites, off the internet.
- Metro-E is Ethernet across a city. An EPL takes the whole port to one place, and EVPL circuits share a port, one VLAN each. Between cities it is L2 transport, and between countries IEPL.
- Inside its network, a provider keeps customers apart by adding its own outer tag around theirs. This is QinQ.
- An IP VPN routes between all your sites for you. An IPLC is a fixed circuit between two countries.
- Leased line is the general word for a private circuit rented between your places.
- Dark fiber is a bare fiber you light yourself. WDM puts many links on one fiber, CWDM cheaply across a city, and DWDM over long distances. A wavelength is one color on the provider's DWDM.
- SD-WAN builds encrypted tunnels over the links you already have. It is cheap, but nothing under it is committed.
