---
title: Academy glossary
description: Short meanings of the words Circuit Academy teaches, and of the words providers use in quotes and contracts, each with the lesson that explains it.
discussion: false
---

# Glossary

Short meanings of the words the Academy uses, from the first lesson to the last, and of the words you meet in a provider's quote or contract. Where a lesson explains a word properly, it is linked. Words about Circuit itself are in the [documentation's glossary](/guide/glossary).

## Networks and addresses

| Word                  | Meaning                                                                                                                                                      | Learn it in                                             |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| Packet                | A small piece of a message, with where it is from, where it goes, and its place in the message.                                                              | [Messages in pieces](/academy/beginner/packets)         |
| Hardware address, MAC | The address fixed in a network card, used to reach a device on the same local network.                                                                       | [Addresses](/academy/beginner/addresses)                |
| IP address            | The address a network gives a device, used to reach it from anywhere.                                                                                        | [Addresses](/academy/beginner/addresses)                |
| Bit, byte             | A digit that is 0 or 1; eight of them, holding a number from 0 to 255.                                                                                       | [Counting like a computer](/academy/beginner/binary)    |
| Prefix                | A block of addresses, such as `192.168.1.0/24`: the number after the slash is how many bits name the network.                                                | [Reading an IP address](/academy/beginner/ip-addresses) |
| Ethernet              | The standard for frames on a cable, used by almost every wired network; Wi-Fi carries the same frames over radio.                                            | [Switches](/academy/beginner/switches)                  |
| ARP                   | How a device finds the hardware address behind an IP address on its own network, by asking everyone with a broadcast.                                        | [Routers and the gateway](/academy/beginner/routers)    |
| LAN                   | The local network of one place, joined by switches.                                                                                                          | [Switches](/academy/beginner/switches)                  |
| Default gateway       | The router a device sends everything for other networks to.                                                                                                  | [Routers and the gateway](/academy/beginner/routers)    |
| TTL                   | A counter on a packet that each router lowers by one, so a lost packet cannot loop forever. DNS uses the word too, for how long an answer may be remembered. | [Routers and the gateway](/academy/beginner/routers)    |
| ICMP                  | Short messages about delivery itself, such as a ping and its reply, or a router saying a packet's TTL ran out.                                               | [Routers and the gateway](/academy/beginner/routers)    |
| DNS                   | The system that turns a name such as `circuit.tako.id` into an IP address.                                                                                   | [Names and numbers: DNS](/academy/beginner/dns)         |
| Port                  | A number that says which program on a device a message is for, such as 443 for HTTPS.                                                                        | [Ports and protocols](/academy/beginner/ports)          |
| TCP, UDP              | TCP checks that every piece arrives, in order; UDP just sends.                                                                                               | [Ports and protocols](/academy/beginner/ports)          |
| QUIC                  | A newer way to carry web pages over UDP, with its own checking, resending and encryption. HTTP/3 runs on it.                                                 | [Ports and protocols](/academy/beginner/ports)          |
| SSH, FTP, SMTP        | Logging in to a device, encrypted; an old way to send files, with the password in plain text; passing mail between mail servers.                             | [Ports and protocols](/academy/beginner/ports)          |
| VLAN                  | A separate network on the same switches, told apart by a number from 1 to 4094.                                                                              | [VLANs](/academy/elementary/vlans)                      |
| Trunk                 | A port that carries several VLANs, each frame tagged with its VLAN number.                                                                                   | [Trunks](/academy/elementary/trunks)                    |
| DHCP                  | How a device joining a network is given its address, gateway and DNS servers.                                                                                | [Handing out addresses: DHCP](/academy/elementary/dhcp) |
| NAT, CGNAT            | Rewriting addresses so many devices share one public address; CGNAT does it inside the provider, for many customers.                                         | [Sharing one address: NAT](/academy/elementary/nat)     |
| Firewall              | Rules, read from the top, that decide which traffic may pass.                                                                                                | [Firewalls](/academy/elementary/firewall)               |

## Routing

| Word               | Meaning                                                                                                                       | Learn it in                                                         |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Routing table      | The list of prefixes a router knows, and where to send traffic for each. The longest match wins.                              | [Routing tables](/academy/intermediate/routing-tables)              |
| OSPF               | A routing protocol inside one network: every router learns the map of links and takes the cheapest path.                      | [Routers that talk: OSPF](/academy/intermediate/ospf)               |
| AS, AS number      | A network with its own routing policy on the internet, and the number that names it.                                          | [Networks of networks](/academy/intermediate/autonomous-systems)    |
| BGP                | How networks tell each other which prefixes they can reach.                                                                   | [BGP](/academy/intermediate/bgp)                                    |
| iBGP, eBGP         | BGP between routers of one AS, and between different ASes.                                                                    | [BGP inside a network](/academy/professional/ibgp-at-scale)         |
| Route reflector    | A router that passes iBGP routes on, so not every router needs a session with every other. Circuit has no setting for it yet. | [BGP inside a network](/academy/professional/ibgp-at-scale)         |
| Local preference   | The value BGP compares first, inside one AS, to choose between routes.                                                        | [Choosing the best route](/academy/intermediate/best-path)          |
| Route policy       | Ordered rules that decide which routes are accepted or announced, and change them.                                            | [Route policies](/academy/intermediate/route-policy)                |
| LAG                | Several links joined into one, for more capacity and a spare.                                                                 | [Staying up](/academy/intermediate/redundancy)                      |
| Broadcast storm    | A broadcast going round a loop of switches without end, its copies multiplying.                                               | [Staying up](/academy/intermediate/redundancy)                      |
| VRF                | A separate routing table on one router, so customers with the same addresses stay apart.                                      | [Separate networks on one](/academy/professional/vrfs-and-overlays) |
| RPKI, ROA          | Signed records of which AS may announce a prefix; a ROA is one such record.                                                   | [Hijacks and leaks](/academy/professional/routing-security)         |
| Hijack, route leak | Announcing a prefix that is not yours; passing routes on to networks that should not get them.                                | [Hijacks and leaks](/academy/professional/routing-security)         |
| Blackholing        | Asking a neighbor to drop all traffic to one address, to keep a flood from the rest of the network.                           | [Attacks on the network](/academy/professional/ddos-and-spoofing)   |

## What providers sell

| Word                    | Meaning                                                                                                                                   | Learn it in                                                         |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Last mile, local loop   | The link from the provider's nearest point to the customer's building.                                                                    | [Reaching the customer](/academy/professional/last-mile)            |
| FTTH                    | Fibre to the home: an optical fibre all the way into the customer's home, instead of copper for the last part.                            | [Reaching the customer](/academy/professional/last-mile)            |
| GPON, OLT               | The common kind of fibre to the home, where one fibre from the provider is split between many homes; the OLT is the provider's end of it. | [Reaching the customer](/academy/professional/last-mile)            |
| ONT                     | The box at the customer's end of a fibre line, which turns light into a network port.                                                     | [Reaching the customer](/academy/professional/last-mile)            |
| CPE                     | Customer premises equipment: the provider's device at the customer's site, such as the ONT or a router.                                   | [Reaching the customer](/academy/professional/last-mile)            |
| Broadband               | Home and small business internet, shared with other customers and sold as best effort.                                                    | [What an ISP sells](/academy/professional/internet-products)        |
| DIA                     | Dedicated internet access: a business connection with a committed rate and a service level agreement.                                     | [What an ISP sells](/academy/professional/internet-products)        |
| IP transit              | A connection to the whole internet sold to another network, which brings its own AS number and addresses.                                 | [What an ISP sells](/academy/professional/internet-products)        |
| IX transit              | Only the routes learned at internet exchanges, sold more cheaply than full transit.                                                       | [What an ISP sells](/academy/professional/internet-products)        |
| CIR                     | Committed information rate: the bandwidth a provider guarantees, as opposed to what you may burst to.                                     | [What an ISP sells](/academy/professional/internet-products)        |
| SLA                     | Service level agreement: what the provider promises, such as uptime and repair time, and what it owes if it misses.                       | [What an ISP sells](/academy/professional/internet-products)        |
| 95th percentile         | A way of billing by traffic: the busiest 5 percent of samples are ignored, and the highest of the rest is billed.                         | [What an ISP sells](/academy/professional/internet-products)        |
| Metro-E                 | Ethernet between sites within one city, carried by a provider.                                                                            | [Carrying your own traffic](/academy/professional/private-circuits) |
| L2 transport, EPL, EVPL | A provider carrying your Ethernet frames between two places, on a port of its own (EPL) or as one VLAN of several (EVPL).                 | [Carrying your own traffic](/academy/professional/private-circuits) |
| IP VPN                  | A provider joining a company's sites into one private routed network.                                                                     | [Carrying your own traffic](/academy/professional/private-circuits) |
| IPLC, IEPL              | Private circuits between countries: an IPLC is a dedicated line at a fixed capacity, an IEPL carries Ethernet.                            | [Carrying your own traffic](/academy/professional/private-circuits) |
| Dark fibre, DWDM        | Fibre rented with no equipment on it; DWDM, which sends many wavelengths, each a separate link, down one fibre.                           | [Carrying your own traffic](/academy/professional/private-circuits) |
| SD-WAN                  | Software that joins a company's sites over ordinary internet links, choosing a path for each kind of traffic.                             | [Carrying your own traffic](/academy/professional/private-circuits) |
| VSAT                    | Internet over a satellite dish, for places no cable reaches; geostationary links bring a long delay.                                      | [Reaching the customer](/academy/professional/last-mile)            |

## Who and where

| Word                            | Meaning                                                                                                                              | Learn it in                                                      |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| Upstream, downstream            | The network you buy transit from, and the networks that buy it from you.                                                             | [Who runs the internet](/academy/professional/who-is-who)        |
| Internet exchange, IX           | A place where many networks connect to each other on one shared network.                                                             | [Networks of networks](/academy/intermediate/autonomous-systems) |
| PoP                             | Point of presence: a place where a network has equipment and can hand over a connection.                                             | [Who runs the internet](/academy/professional/who-is-who)        |
| Backhaul                        | The link that carries traffic from a PoP or a local site back to the core of the network.                                            | Glossary only                                                    |
| Cross-connect, meet-me room     | A cable a data centre runs between two customers' racks; the room where networks meet to run them.                                   | [Who runs the internet](/academy/professional/who-is-who)        |
| RIR, NIR                        | The registries that hand out addresses and AS numbers: APNIC for Asia and the Pacific, and national ones such as IDNIC in Indonesia. | [Who runs the internet](/academy/professional/who-is-who)        |
| Core, edge, aggregation, access | The roles of devices in a network, from the centre out to where customers plug in.                                                   | [Roles in a network](/academy/professional/device-roles)         |
| Top of rack, leaf and spine     | The switch in each data centre rack, and the layout that joins every one of them to every core switch.                               | [Roles in a network](/academy/professional/device-roles)         |
| NOC                             | Network operations centre: the people who watch the network and answer when it breaks.                                               | [Running it day to day](/academy/professional/operations)        |
| DCIM, IPAM                      | Records of the physical plant (racks, power, cables), and of which addresses are used where.                                         | [Running it day to day](/academy/professional/operations)        |
| SNMP, MRTG                      | The protocol for reading counters from a device, and the early tool that drew traffic graphs from them.                              | [Watching the network](/academy/professional/monitoring)         |
