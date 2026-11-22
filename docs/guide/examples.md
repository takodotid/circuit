---
description: Seven whole projects to copy from, tested on every change to Circuit.
---

# Example projects

Copy the project closest to your network from [`examples/`](https://github.com/takodotid/circuit/tree/main/examples), and change it to yours. Each one passes `circuit validate` on every change to Circuit.

## A single site

A home, an office, or an internal network. It has a router, a switch, three VLANs, DHCP, and a firewall, but no BGP.

::: code-group

<<< @/../examples/single-site/circuit.ts

<<< @/../examples/single-site/sites/home/site.ts

<<< @/../examples/single-site/sites/home/router.ts

<<< @/../examples/single-site/sites/home/switch.ts

<<< @/../examples/single-site/lib/checks.ts

:::

## An edge router

Your own AS with two edge routers, a broadband gateway, an access router in the next town, and the router of an office of yours. The first edge router has IP transit from Hurricane Electric, peering at DE-CIX, filters both ways, BGP communities, and CGNAT for the access network's subscribers. The second, on Junos, peers at AMS-IX, sells transit to a customer that takes only a default route, and has a few servers. Both check the source of what arrives with uRPF. Behind the first, the broadband gateway serves homes on an OLT with PPPoE, or with DHCP on a second PON port (IPoE), and RADIUS checks each home. The OLT tags with 802.1ad's service tag, and a business on a third PON port ends in a VLAN of its own inside the port's (QinQ). A home router that asks gets an IPv6 prefix, and a /64 for its side of the session by SLAAC. Each PPPoE session joins an interface set with the DHCP homes, so a few firewall rules keep every home off the router. The access router relays the DHCP requests of an apartment block's homes to the gateway with Option 82, and RADIUS lets them in by their line. It holds each home to its own rate. The office router logs in to the gateway as a home does, asks for its own /56 with a prefix hint, gives the office a /64 of it, and makes its own IPv6 address on the session.

::: code-group

<<< @/../examples/edge-router/circuit.ts

<<< @/../examples/edge-router/sites/pop-1/edge-01.ts

<<< @/../examples/edge-router/sites/pop-2/edge-02.ts

<<< @/../examples/edge-router/sites/pop-1/bng-01.ts

<<< @/../examples/edge-router/sites/pop-3/acc-01.ts

<<< @/../examples/edge-router/sites/office-1/cpe-01.ts

:::

## A backbone in two regions

Your AS in two regions, each a member AS of a BGP confederation with its own iBGP. The core routers, one on Junos and one on FortiOS, run eBGP between the regions, and transit providers see only your AS. IS-IS carries the loopbacks. Two branch offices reach the south region over IPsec tunnels, and the internet from a pool of your addresses that hands out blocks of ports and logs each. A third tunnel, from behind an office's NAT, is the operators' way in out of band.

::: code-group

<<< @/../examples/backbone/circuit.ts

<<< @/../examples/backbone/sites/north/core-01.ts

<<< @/../examples/backbone/sites/south/core-02.ts

:::

## An MPLS core

Three provider edge routers in a row, one in each point of presence. IS-IS carries their IPv4 and IPv6 loopbacks, and LDP gives each a label (RFC 7552 for IPv6), so traffic between them crosses the core by label. The policies of LDP keep its labels to the loopbacks. A bank has an office at `pe-01` and `pe-02`, in its VRF `bank`. The two VRFs share a route target, and iBGP between the loopbacks carries their routes as VPN routes (L3VPN, RFC 4364), the IPv6 ones between the IPv6 loopbacks (RFC 4659). The VRFs' policies let only the offices' networks cross. A clinic's two sites share one Ethernet segment: each site's port is in the VLAN `clinic` with a pseudowire to the other router (VPWS). A TV station's two VLANs cross between `pe-02` and `pe-03` on one pseudowire, each frame with its tag. Between `pe-01` and `pe-02`, QinQ ports and a QinQ pseudowire carry an internet provider's own VLANs inside the VLAN `isp`. A museum's two sites, at `pe-01` and `pe-02`, share another: BGP finds the other router with the museum's VLAN, and each sets up a pseudowire to the other (RFC 4761). A library's two branches, at `pe-01` and `pe-03`, share a third, whose pseudowire LDP sets up once BGP has found the two routers (RFC 6074). `pe-01` and `pe-03` are no neighbors, so a targeted LDP session joins them across `pe-02`, over which each gives the other only its own loopback's label. A school's two campuses, at `pe-02` and `pe-03`, share the VLAN `school` across the core in a VXLAN segment, and iBGP between the two loopbacks tells each router the other's VTEP and the MAC addresses behind it (EVPN, RFC 8365).

::: code-group

<<< @/../examples/mpls-core/circuit.ts

<<< @/../examples/mpls-core/sites/pop-1/pe-01.ts

<<< @/../examples/mpls-core/sites/pop-2/pe-02.ts

<<< @/../examples/mpls-core/sites/pop-3/pe-03.ts

:::

## A metro ring with traffic engineering

Three routers of a city's metro network in a ring, each one link away from the other two. OSPF carries their loopbacks, and tells every router how much bandwidth each link has left for tunnels (RFC 3630). LDP labels the loopbacks. A TV station's two studios, at `ring-01` and `ring-03`, share one Ethernet segment through a pseudowire, which crosses the ring in RSVP-TE tunnels that reserve 10G each way (RFC 3209). From `ring-01`, CSPF computes the tunnel's path: the direct link, while it has the bandwidth. The way back follows an explicit path the long way round, through `ring-02`, which starts no tunnel and runs RSVP-TE for the one that crosses it.

::: code-group

<<< @/../examples/metro-ring/circuit.ts

<<< @/../examples/metro-ring/sites/north/ring-01.ts

<<< @/../examples/metro-ring/sites/east/ring-02.ts

<<< @/../examples/metro-ring/sites/south/ring-03.ts

:::

## A campus on OSPF

Five routers on private IPv4 addresses and the campus's own IPv6 prefix, running OSPF without BGP. The core router is the backbone's designated router, with BFD on the backbone VLAN, and announces a static route to the labs into OSPF. The library's router joins the backbone with priority 0, and is the border router of a totally stubby area. It announces the area to the backbone as one range for each family, and hides the archive. It gives each visitor on its guest Wi-Fi a rate of its own. In that area, the field station's router runs IPv4 only. Its radio to two stations that don't hear each other is point-to-multipoint, with a key. Its carrier's line carries no multicast, so it is NBMA, with its neighbor written out. It says hello less often there. The museum runs IPv4 only. Its router is on the backbone VLAN, and a fiber leads to the galleries' router, in an area between them. The galleries' router has no link into the backbone, so a virtual link to the museum's router, across that area, joins it. It announces the galleries' area as one range, at a cost of its own.

::: code-group

<<< @/../examples/campus/circuit.ts

<<< @/../examples/campus/sites/data-center/core-01.ts

<<< @/../examples/campus/sites/library/library-01.ts

<<< @/../examples/campus/sites/field-station/field-01.ts

<<< @/../examples/campus/sites/museum/museum-01.ts

<<< @/../examples/campus/sites/museum/museum-02.ts

:::

## Colocation with tenants

A router, two top-of-rack switches, the meet-me room's switch, and the router of hall 2, a VRP switch the router reflects routes to, whose transit customer announces its own block over BGP, and may send only from its own addresses. The router is managed in a VRF of its own, and reaches its time, name, and monitoring servers in another. Each tenant, here Terramix, has its own file with its VLANs, gateway, ports, and rules, and a VRF that keeps its private network apart, with a BGP session over its private circuit. Devices pull them in with `include`. See [Parts and merge](/guide/parts). Small tenants share a subnet on the second switch, in a private VLAN that keeps their servers apart, and its port guards keep each tenant from harming the others. A tenant's own VLANs reach its racks in another hall inside one VLAN, with QinQ. Carriers hand off on the meet-me room's Raisecom switch: each port toward another network stays out of the spanning tree or its root, limits what it floods, and a tenant's transit is held to the rate the tenant pays for.

::: code-group

<<< @/../examples/colocation/circuit.ts

<<< @/../examples/colocation/tenants/terramix.ts

<<< @/../examples/colocation/tenants/index.ts

<<< @/../examples/colocation/sites/dc-1/site.ts

<<< @/../examples/colocation/sites/dc-1/edge-01.ts

<<< @/../examples/colocation/sites/dc-1/tor-01.ts

<<< @/../examples/colocation/sites/dc-1/tor-02.ts

<<< @/../examples/colocation/sites/dc-1/mmr-01.ts

<<< @/../examples/colocation/sites/dc-1/hall-2.ts

:::

## An internet exchange

Two switches carry one peering LAN. Each member, such as Cloudflare or Google, has its own file with its port. Circuit runs the switches, and the route servers run their own software.

::: code-group

<<< @/../examples/internet-exchange/circuit.ts

<<< @/../examples/internet-exchange/members/cloudflare.ts

<<< @/../examples/internet-exchange/members/index.ts

<<< @/../examples/internet-exchange/sites/ix-1/site.ts

<<< @/../examples/internet-exchange/sites/ix-1/ix-sw-01.ts

<<< @/../examples/internet-exchange/lib/checks.ts

:::
