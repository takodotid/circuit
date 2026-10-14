---
title: Carrying your own traffic
description: Metro-E, EPL and EVPL, IP VPN, IPLC and IEPL, dark fibre, wavelengths and SD-WAN, told apart. Match each to a need, and hand one over on a port.
---

# Carrying your own traffic

Internet products carry a customer's traffic to the rest of the internet. **Private circuits** carry it between the customer's own sites, offices, data centres, branches abroad, without crossing the internet at all. A company buys one when it wants a rate it can count on between its sites, a delay that does not change, or simply to keep its traffic off the internet.

They differ in what the provider carries for you. With dark fibre and wavelengths, it carries light, and you run everything on it. With Ethernet services it carries frames, and you route. With an IP VPN it carries packets and does the routing too. SD-WAN is the odd one: it is built over internet links, not instead of them.

## Choose by what you want to run

The older, general word for all of these is a <Term means="A private circuit rented from a provider between two or more places, always on and kept for one customer alone. Metro-E lines, IEPLs and IPLCs are all kinds of leased line.">leased line</Term>: a private circuit between your places, rented from a provider, always on and kept for you alone. Quotes still use it, sometimes for a line to the internet as well, so ask what exactly is carried and between which two points.

The lower the layer you buy, the more capacity you get and the more you run yourself:

| You buy                     | The provider carries                | You run                              | Reach                               |
| --------------------------- | ----------------------------------- | ------------------------------------ | ----------------------------------- |
| Dark fibre                  | Nothing: a bare fibre               | The optics and everything above them | Where spare fibre runs              |
| A DWDM wavelength           | Light, at a fixed rate              | Everything above the light           | Point to point, often long distance |
| Metro-E, L2 transport, IEPL | Ethernet frames                     | Addresses and routing                | A city, a country, abroad           |
| IPLC                        | A fixed-rate circuit                | Addresses and routing                | Between countries                   |
| IP VPN                      | IP packets, routed                  | Only your own sites' routers         | Wherever the provider is            |
| SD-WAN                      | Nothing: it rides on internet links | The tunnels, or a provider runs them | Wherever there is internet          |

## Ethernet across a city: Metro-E, EPL and EVPL

<Term means="Metro Ethernet: Ethernet between sites across one city, carried by a provider's network.">Metro-E</Term> is Ethernet carried across a city by a provider: plug a router into a port at each office, and the two behave as if a long cable joined them. The services are named by the MEF, the industry body that defined them, renamed the Mplify Alliance in 2025. The common one is the point-to-point line, which comes in two kinds:

- An <Term means="Ethernet private line: a point-to-point Ethernet circuit that takes the whole port. Everything sent on it, tagged or not, arrives at the far end as it was.">EPL</Term>, Ethernet private line, takes the whole port. Every frame you send on it, tagged with any VLAN or not, arrives at the far end as it left. The provider never looks at your tags.
- An <Term means="Ethernet virtual private line: a point-to-point Ethernet circuit chosen by VLAN, so one port can carry several circuits to different places.">EVPL</Term>, Ethernet virtual private line, is chosen by VLAN. One port can carry several EVPLs, each a VLAN that goes to a different place: VLAN 2010 to the branch, VLAN 2020 to the data centre. The VLAN numbers are agreed with the provider.

The same Ethernet services between cities are often sold as **L2 transport** or an Ethernet private line, and they come as EPL or EVPL too.

<TryIt title="Hand over circuits on one port">

You bought an EVPL to the branch office. Send frames with different tags, buy a second EVPL to the data centre, then switch to an EPL. Watch the Circuit file change.

<EvplHandoff />

</TryIt>

An EPL hands you one link, so in Circuit the port itself is the link and gets the address. EVPLs hand you a trunk, so the port carries VLANs and each VLAN gets an interface with its own address, exactly the [trunks](/academy/elementary/trunks) you already know. The [colocation pattern](/patterns/colocation) hands tenants their networks the same way, as VLANs on a port. Each circuit is a small network of two routers, usually a /30 or /31, and you route over it with static routes or OSPF, as between any two of your routers.

<Quiz
  question="Your office router has one free port toward the provider. You need a circuit to the branch office and another to the data centre. What do you buy?"
  :choices="['One EPL, which carries everything', 'Two EVPLs on the same port, one VLAN each', 'Two EPLs on the same port']"
  :answer="1"
  :why="['An EPL goes to one far end only. Everything on the port arrives there, so the data centre would never see it.', '', 'An EPL takes the whole port. Two of them need two ports.']"
  explain="EVPLs are chosen by VLAN, so one port carries both: one VLAN to the branch, another to the data centre."
/>

## Routed for you: IP VPN

With an <Term means="A provider joining a customer's sites into one private routed network: the customer's routers tell the provider their routes, and the provider routes between the sites.">IP VPN</Term>, the provider does the routing. Your router at each site, which the standard calls the customer edge, tells the provider's router, the provider edge, which addresses are behind it, over BGP, OSPF or static routes. The provider then carries packets between all your sites, any site to any other, and keeps your routes apart from every other customer's, even if you both use the same private addresses. The standard for it is RFC 4364, often called MPLS L3VPN after the technology providers build it with, and [Separate networks on one](/academy/professional/vrfs-and-overlays) shows how a provider keeps customers apart inside.

It fits a company with many sites that wants them all to reach each other, and does not want to run the routing between them.

## Between countries: IPLC and IEPL

An <Term means="International private leased circuit: a dedicated point-to-point circuit between two countries, at a fixed capacity reserved for one customer.">IPLC</Term>, international private leased circuit, is a dedicated line between two sites in different countries, at a fixed capacity reserved for the customer alone. It was traditionally built on the older circuit technologies of telephone networks, SONET and SDH, and may be handed over on an interface that is not Ethernet.

An <Term means="International Ethernet private line: a dedicated point-to-point Ethernet line between two countries.">IEPL</Term>, international Ethernet private line, is the same idea handed over as Ethernet, so it plugs into an ordinary router or switch port. Both are point to point: for many sites in many countries, an IP VPN usually fits better.

## Light itself: dark fibre and wavelengths

<Term means="A fibre already in the ground or on poles, rented with no equipment at either end. The customer lights it with its own optics.">Dark fibre</Term> is a fibre already in the ground, rented with nothing on it. You put your own optics at both ends and run it at whatever speed they support, and change them when you need more. It is rented where spare fibre already runs, mostly in and around cities and between data centres, and often for a long term, under a contract called an <Term means="Indefeasible right of use: a long contract, often 20 to 30 years, that gives the right to use a fibre or capacity and cannot be taken back.">IRU</Term>. The fibre is the provider's; everything that lights it is yours, faults included.

One fibre can carry many links at once, each on its own wavelength, its own colour of light. This is <Term means="Wavelength division multiplexing: sending several links down one fibre at once, each on its own wavelength of light, and separating them again at the far end.">WDM</Term>, wavelength division multiplexing, and it comes in two common kinds:

- <Term means="Coarse wavelength division multiplexing: up to 18 wavelengths 20 nm apart on one fibre, with cheap optics, over city distances, and no amplifiers.">CWDM</Term>, coarse WDM, spaces its colours widely: up to 18 channels, 20 nm apart, from 1270 to 1610 nm (ITU-T G.694.2). The wide gaps let the optics be simple and cheap, but the light cannot be amplified on the way, so it suits distances across a city, a few tens of kilometres.
- <Term means="Dense wavelength division multiplexing: many wavelengths packed closely on one fibre, such as 40 channels 100 GHz apart, which amplifiers can carry over long distances.">DWDM</Term>, dense WDM, packs its colours tightly: 40 channels 100 GHz apart, or 80 channels 50 GHz apart, on the ITU-T G.694.1 grid. They sit in the band optical amplifiers work in, so a DWDM line can run between cities and across countries, with an amplifier every 80 to 100 km.

So CWDM is how you get more out of your own dark fibre across a city, and DWDM is what long fibre routes run on. A provider with DWDM on its fibre can sell one **wavelength**: a link at a fixed rate, such as 10 or 100 Gbit/s, that carries whatever you send on it. You get a whole link's capacity without lighting the fibre yourself, and other customers ride other colours on the same fibre.

## Over the internet: SD-WAN

<Term means="Software-defined WAN: encrypted tunnels between a company's sites over the links it already has, mostly internet, with each kind of traffic sent the best way, managed from one place.">SD-WAN</Term> joins sites with tunnels over the links they already have, such as broadband, DIA, or an IP VPN. The MEF defines it as a service that encrypts traffic between its edges and sorts it into flows by application, then sends each flow over the link its policy picks: video calls over the steadiest link, backups over the cheapest. It is managed from one place, by the company or by a provider that sells it as a service.

It costs far less than a private circuit to every site, and a site with two internet links survives one failing. But nothing below it is committed: the delay and the loss are whatever the internet gives that day. So it suits small sites well, while a site that needs a promise keeps a private circuit or an IP VPN, which SD-WAN can then use as one of its links.

<TryIt title="Match the product to the need">

Pick a need, then try the products against it until you have found every one that fits. Each answer says why.

<CircuitScenarios />

</TryIt>

Most needs have more than one answer, and the choice is a trade: the lower the layer, the more capacity and the more you run yourself; the higher, the less you run and the more you depend on the provider. Distance rules out the rest: Metro-E stays in a city, IPLC and IEPL cross borders, and dark fibre goes only where spare fibre already runs.

<Quiz
  question="Two data centres 30 km apart copy 100 Gbit/s of storage between them, and the team does not want to run optical equipment. What fits?"
  :choices="['A DWDM wavelength from a provider', 'Dark fibre', 'An IP VPN']"
  :answer="0"
  :why="['', 'Dark fibre fits the capacity, but someone must light it: the optics and any DWDM equipment are yours to run.', 'An IP VPN joins sites by routing for them. It is not a pipe for 100 Gbit/s of steady copies.']"
  explain="A wavelength gives a whole 100 Gbit/s link between the two sites, and the provider runs the DWDM equipment. Buy a second wavelength when the copies grow."
/>

<Quiz
  question="Forty shops each have an ordinary broadband line, and need to reach the head office cheaply. Where does SD-WAN fit?"
  :choices="['It replaces the broadband lines', 'It builds encrypted tunnels over the broadband lines the shops already have', 'It needs a private circuit to every shop first']"
  :answer="1"
  :why="['SD-WAN needs links underneath it. It does not carry anything by itself.', '', 'It can use private circuits, but it does not need them. Running over broadband is what makes it cheap.']"
  explain="SD-WAN rides on the links a site already has. Over broadband it costs little, though nothing below it commits to a rate or a delay."
/>

## Further reading

- [Carrier Ethernet](https://en.wikipedia.org/wiki/Carrier_Ethernet): E-Line, EPL and EVPL as the MEF defines them.
- [RFC 6004](https://www.rfc-editor.org/rfc/rfc6004.html): EPL as port-based, EVPL as several circuits per port chosen by VLAN.
- [Metro Ethernet](https://en.wikipedia.org/wiki/Metro_Ethernet): Ethernet services across a city; and [From MEF to Mplify](https://www.mplify.net/edge-view-blog/from-mef-to-mplify-a-new-name-for-a-new-era/), the MEF's new name.
- [RFC 4364](https://www.rfc-editor.org/rfc/rfc4364): BGP/MPLS IP VPNs, customer edge and provider edge.
- [What is IPLC](https://www.iptp.net/what-is-iplc/), IPTP Networks: a dedicated circuit between countries, against MPLS VPNs.
- [What are the differences between IEPL and IPLC](https://www.simcentric.com/hong-kong-dedicated-server/what-are-the-differences-between-iepl-and-iplc/), Simcentric: Ethernet against circuit switching.
- [Dark fibre](https://en.wikipedia.org/wiki/Dark_fibre), [Dark fibre](https://www.lexisnexis.com/en-gb/legal/glossary/dark-fibre) in the LexisNexis glossary, and [Indefeasible rights of use](https://en.wikipedia.org/wiki/Indefeasible_rights_of_use).
- [Leased line](https://en.wikipedia.org/wiki/Leased_line): a private circuit between two or more places, dedicated to one customer.
- [Wavelength-division multiplexing](https://en.wikipedia.org/wiki/Wavelength-division_multiplexing): CWDM on the ITU-T G.694.2 grid, DWDM channels on the G.694.1 grid, and why only DWDM is amplified; and [Wavelengths](https://arelion.com/products-and-services/networking/wavelengths), Arelion: a wavelength service as a transit provider sells it.
- [MEF 70 SD-WAN Service Attributes and Services](https://www.lightwaveonline.com/network-automation/article/14038725/mef-releases-mef-70-sd-wan-service-attributes-and-services-standard), Lightwave, and the MEF's [MEF 3.0 SD-WAN Services](https://www.mplify.net/wp-content/uploads/2019/11/MEF-Presentation-WS-Vid-MEF-3-0-SD-WAN-Services.pdf) presentation: application flows, policies, encryption between edges, and the links underneath.

## In short

- Private circuits carry a company's traffic between its own sites, off the internet.
- Metro-E is Ethernet across a city: an EPL takes the whole port to one place, EVPLs share a port, one VLAN each. Between cities it is L2 transport, and between countries IEPL.
- An IP VPN routes between all your sites for you; an IPLC is a fixed circuit between two countries.
- Leased line is the general word for a private circuit rented between your places.
- Dark fibre is a bare fibre you light yourself; WDM puts many links on one fibre, CWDM cheaply across a city, DWDM over long distances, and a wavelength is one colour on the provider's DWDM.
- SD-WAN builds encrypted tunnels over the links you already have, cheaply, but with nothing committed below it.
