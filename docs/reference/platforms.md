---
description: The device operating systems Circuit works with, their versions, and which feature works on each.
---

# Platforms

| `platform`     | OS                | Version    | Tested on                                                                          |
| -------------- | ----------------- | ---------- | ---------------------------------------------------------------------------------- |
| `routeros`     | MikroTik RouterOS | 7          | CCR2216-1G-12XS-2XQ, RouterOS 7.23; RB5009UG+S+, RouterOS 7.24; CHR, RouterOS 7.24 |
| `vrp`          | Huawei VRP        | V200R005   | CE6855-48S6Q-HI, V200R005C00SPC800                                                 |
| `raisecom-ros` | Raisecom ROS      | 6.5        | RAX721-C-6C48, ROS 6.5.2                                                           |
| `junos`        | Juniper Junos     | 21.3, 21.4 | QFX5100-48S-6Q, Junos 21.4R3                                                       |
| `fortios`      | Fortinet FortiOS  | 6.2        | FG-3700D, FortiOS 6.2.2                                                            |

- **One version per platform.** `routeros` means RouterOS 7. RouterOS 6 takes other commands, so Circuit doesn't support it.
- **Version check.** On RouterOS, Junos, and FortiOS, `diff` and `apply` stop if the device runs another version. VRP and Raisecom ROS don't check, so check the version yourself before the first apply.
- **Only the models it was tested on.** Another model needs its port list added. See [Contributing](/contributing).
- **Model limits.** On the CCR2216, a LAG holds at most 8 ports, and the hardware ACLs hold about 5 different port ranges. `circuit validate` checks both. The RB5009 has no serial console, so Circuit refuses `connection.console` on it.
- **CHR.** MikroTik's Cloud Hosted Router is RouterOS in a virtual machine. Its ports are the machine's network adapters, as many as it has: `virtual-1` is `ether1`, and so on. Circuit disables every adapter the config leaves out.
- **A RouterOS PPPoE server.** Subscribers live in RADIUS. Before the first `apply` on a router that already serves PPPoE, move every subscriber from `/ppp secret` to RADIUS: the plan removes each local secret, PPP profile, and PPPoE server that `services.pppoe_server` doesn't write, and sets the profiles `default` and `default-encryption` back to RouterOS's defaults. A prefix RADIUS sends (`Delegated-IPv6-Prefix`) needs no setting: the session delegates it, with or without `prefix_delegation`.
- **A RouterOS DHCP server with `radius`.** RouterOS asks RADIUS with the client's MAC address in capitals as `User-Name`, such as `52:54:00:00:0B:02`, and an empty password, so the RADIUS server lets a client in by its MAC address alone. A lease lasts the `Session-Timeout` of the server's accept when it has one. All the DHCP servers that have `radius` share one list of RADIUS servers and one `acct_interim_interval`.
- **VRP.** A CloudEngine filters with ACLs on its ports, so write hardware ACLs. Circuit refuses the firewall's chains there: the switch's traffic filter checks what it switches as well as what it routes, V200R005 filters traffic to the switch only with a blacklist, and nothing filters what the switch sends. A DHCP server is an address pool, and nothing on the switch ties it to its interface. IS-IS is one process, `isis 1`: a CE6855 committed it with a leak into level 1, the overload bit, and both topologies, but no VLAN interface ran it yet, so IS-IS on an interface is experimental.
- **RouterOS and 802.1ad.** Every switched port is on one bridge, whose `ether-type` is one TPID for all of them. So `tpid: "0x88a8"` goes on every switched port and LAG, or on none. A frame with an 802.1Q tag then counts as untagged on each port: an access port takes it into its VLAN, with its tag inside, as a QinQ port does. Circuit refuses DHCP snooping, RA guard, `stp: false`, `ethertypes`, hardware ACLs, and pseudowires beside it, as none was tried on such a bridge. A VLAN interface with `inner_vlan_id` is a VLAN interface on the outer VLAN's. That is the outer VLAN's plain VLAN interface when there is one, or else one Circuit adds, named after the VLAN.
- **RouterOS IS-IS on both levels.** A router on both levels leaks every level 2 route into level 1, and its filter chain held none back, so Circuit refuses `level2_to_level1` there. The level 1 routers behind it got no default route from it either.
- **Raisecom ROS.** The switch answers time queries whenever it takes time from `system.ntp`, and nothing stops it, so write `services.ntp_server`, or `validate` warns. BPDU guard is one setting for the whole switch, and the switch finds edge ports by itself: with `bpdu_guard`, write `edge` on each port that runs spanning tree. Raisecom's guide doesn't say how an ACL rule matches a TCP or UDP port, and a switch's SSH key belongs to no user, so hardware ACLs and SSH keys wait.

## Feature matrix

The table comes from Circuit's code, not from datasheets. [Standards](/reference/standards) lists the RFC behind each feature.

| Mark | Means                                                                                                                                                               |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ✅   | Works, and tested on a real device.                                                                                                                                 |
| ❌   | Not on this platform, or not built yet. Circuit stops you.                                                                                                          |
| 🧪   | Built from the vendor's documentation, but not tested on a real device yet. Circuit stops, unless you add `--experimental`. Then it's a warning, and yours to test. |

A note in a cell means "works, with this limit".

### Switching

| Feature             | RouterOS                           | VRP                 | Raisecom ROS                          | Junos                   | FortiOS             |
| ------------------- | ---------------------------------- | ------------------- | ------------------------------------- | ----------------------- | ------------------- |
| VLANs, access/trunk | ✅                                 | ✅                  | ✅                                    | ✅                      | ✅ VLAN interfaces  |
| LAG                 | ✅                                 | ✅                  | ✅                                    | ✅                      | ✅                  |
| STP                 | ✅                                 | ✅                  | MSTP, no port cost                    | ✅                      | ❌ ports are routed |
| Storm control       | ✅ in percent                      | ✅ in percent       | broadcast and unknown unicast, in pps | ✅                      | ❌                  |
| MAC limit           | ❌                                 | ✅ ports            | ✅ ports                              | ✅                      | ❌                  |
| Ethertype filter    | ✅ ports                           | ✅ ports            | ✅ ports                              | ✅                      | ❌                  |
| Port bound to hosts | ❌                                 | ❌                  | ❌                                    | ✅                      | ❌                  |
| BPDU and root guard | ✅ ports                           | 🧪                  | root guard; 🧪 BPDU guard             | ✅                      | ❌                  |
| DHCP snooping       | ✅                                 | 🧪                  | 🧪                                    | ✅                      | ❌                  |
| ARP inspection      | ❌                                 | ❌                  | ❌                                    | ✅                      | ❌                  |
| Private VLANs       | isolated only, switched by the CPU | ❌                  | ❌                                    | ✅                      | ❌                  |
| QinQ                | ✅                                 | 🧪                  | ✅ ports                              | ✅                      | ❌                  |
| VLAN translation    | ❌                                 | ❌                  | ❌                                    | 🧪 no native VLAN       | ❌                  |
| 802.1ad service tag | ✅ on every switched port at once  | ❌                  | ❌                                    | ❌ needs 22.4           | ❌                  |
| RA guard            | ✅                                 | ❌                  | ❌                                    | ✅                      | ❌                  |
| Hardware ACLs       | ✅                                 | ✅ no rate, no VLAN | ❌                                    | ✅ a rate needs a burst | ✅ drop rules only  |
| LLDP                | ✅                                 | ✅                  | ✅                                    | ✅                      | ✅                  |
| Bridge interface    | ❌                                 | ❌                  | ❌                                    | ❌                      | ✅                  |

### Interfaces

| Feature                         | RouterOS                                                                                   | VRP               | Raisecom ROS                        | Junos                                                                      | FortiOS                                        |
| ------------------------------- | ------------------------------------------------------------------------------------------ | ----------------- | ----------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------- |
| VLAN interface                  | ✅                                                                                         | ✅                | ✅                                  | ✅                                                                         | ✅                                             |
| VLAN interface on an inner VLAN | ✅                                                                                         | ❌                | ❌                                  | ❌                                                                         | ❌                                             |
| Routed port, loopback           | ✅                                                                                         | ❌                | ❌                                  | ✅                                                                         | ✅                                             |
| GRE                             | ✅                                                                                         | ❌                | ❌                                  | ✅                                                                         | ✅                                             |
| VXLAN                           | ✅                                                                                         | ❌                | ❌                                  | ❌                                                                         | ✅                                             |
| IPsec, route-based (IKEv2)      | ❌                                                                                         | ❌                | ❌                                  | ❌                                                                         | ✅                                             |
| IPsec liveness, NAT-T           | ❌                                                                                         | ❌                | ❌                                  | ❌                                                                         | ✅ no NAT keepalive interval with NAT-T always |
| IPsec carrying IPv6             | ❌                                                                                         | ❌                | ❌                                  | ❌                                                                         | ✅ one IPv6 address, without a peer            |
| IPsec with certificates         | ❌                                                                                         | ❌                | ❌                                  | ❌                                                                         | ✅                                             |
| WireGuard                       | ✅                                                                                         | ❌                | ❌                                  | ❌                                                                         | ❌                                             |
| PPPoE client                    | ✅ with a delegated IPv6 prefix and a length hint                                          | ❌                | ❌                                  | ❌                                                                         | ❌ not built yet                               |
| EoIP                            | ✅                                                                                         | ❌                | ❌                                  | ❌                                                                         | ❌                                             |
| Round-robin LAG, ARP check      | ✅                                                                                         | ❌                | ❌                                  | ❌                                                                         | ❌                                             |
| Shaping (CAKE)                  | ✅                                                                                         | ❌                | ❌                                  | ❌                                                                         | ❌                                             |
| Rate limit                      | ✅ routed ports and VLAN interfaces, not beside the fast path or hardware offload; 🧪 LAGs | 🧪 ports and LAGs | ports and LAGs, a burst in whole kB | in on switched ports, with a burst; 🧪 LAGs; out on ports, without a burst | ✅ no burst                                    |
| Proxy ARP for an address        | ❌                                                                                         | ❌                | ❌                                  | ❌                                                                         | ✅                                             |
| VRRP                            | ✅                                                                                         | IPv4              | IPv4                                | IPv4                                                                       | IPv4                                           |
| IPv6 router advertisement       | ✅ no search domains                                                                       | ❌                | ❌                                  | ✅                                                                         | ✅                                             |
| uRPF (RFC 3704)                 | ✅ IPv4, one mode for the router; 🧪 strict beside VRFs                                    | 🧪 loose, IPv4    | ❌                                  | ✅ strict                                                                  | 🧪 strict, one mode for the VDOM               |

### Routing

| Feature                      | RouterOS                | VRP                        | Raisecom ROS             | Junos                 | FortiOS          |
| ---------------------------- | ----------------------- | -------------------------- | ------------------------ | --------------------- | ---------------- |
| Static routes                | ✅                      | ✅                         | IPv4 next hop            | ✅                    | ✅               |
| Next hop with its interface  | ✅                      | ❌                         | ❌                       | ❌                    | ✅               |
| VRFs                         | ✅                      | ✅                         | ❌                       | ✅                    | ✅               |
| BGP in a VRF                 | ✅                      | ❌                         | ❌                       | ✅                    | ❌               |
| Routes taken between VRFs    | ✅ not with main        | ❌                         | ❌                       | 🧪                    | ❌               |
| Policy routing, more tables  | ✅                      | ❌ not yet                 | ❌ not yet               | ❌ not yet            | ❌ not yet       |
| OSPF                         | ✅                      | IPv4                       | IPv4                     | ✅                    | ✅               |
| OSPF in a VRF                | ✅                      | ❌                         | ❌                       | ✅                    | ❌               |
| OSPF stub and NSSA areas     | ✅                      | 🧪                         | ❌                       | ✅                    | ✅               |
| OSPF hello and dead timers   | ✅                      | 🧪                         | ❌                       | ✅                    | ✅               |
| OSPF authentication          | ✅                      | 🧪                         | ❌                       | MD5                   | MD5              |
| OSPF area ranges             | ✅                      | ❌ not yet                 | ❌ not yet               | ❌ not yet            | ❌ not yet       |
| OSPF router priority         | ✅                      | ❌ not yet                 | ❌ not yet               | ❌ not yet            | ❌ not yet       |
| OSPF NBMA and P2MP links     | ✅ OSPFv2               | ❌ not yet                 | ❌ not yet               | ❌ not yet            | ❌ not yet       |
| IS-IS                        | ✅ no passive metric    | 🧪 VLAN interfaces         | ❌                       | ✅                    | ✅ no passive    |
| IS-IS multi-topology         | ❌                      | ✅                         | ❌                       | 🧪                    | ❌               |
| IS-IS authentication         | ❌                      | ❌ not yet                 | ❌                       | ✅                    | ✅               |
| IS-IS overload bit           | ❌                      | ✅                         | ❌                       | ✅                    | ✅               |
| IS-IS leaks into level 1     | ❌ leaks every route    | ✅                         | ❌                       | ❌ not yet            | ❌ not yet       |
| BFD for IS-IS                | ❌                      | ❌ not yet                 | ❌                       | ✅                    | ❌               |
| MPLS with LDP                | ✅                      | ❌                         | ❌                       | 🧪                    | ❌               |
| LDP label policies           | ✅ /32 or prefix set    | ❌                         | ❌                       | ❌                    | ❌               |
| L3VPN over MPLS              | ✅ IPv4, no VRF imports | ❌                         | ❌                       | ❌                    | ❌               |
| VRF import/export policies   | ✅                      | ❌                         | ❌                       | ❌                    | ❌               |
| Ethernet pseudowires, VPLS   | ✅ VLAN interfaces 1496 | ❌                         | ❌                       | ❌                    | ❌               |
| Pseudowire MTU, control word | ✅ MTU 1500 or more     | ❌                         | ❌                       | ❌                    | ❌               |
| BFD                          | ✅ not on static routes | ✅                         | static routes, no timers | ✅                    | ✅               |
| BGP                          | ✅                      | ✅ one family per session  | ❌                       | ✅                    | ✅               |
| Route policies, prefix sets  | ✅                      | ✅ each rule decides       | ❌                       | ✅                    | ✅               |
| BGP communities              | ✅                      | ✅ standard, no `*`        | ❌                       | ✅                    | ✅ no large ones |
| AS path matches              | ✅                      | ✅ one per rule, no length | ❌                       | ✅ 21.3 or later      | ✅ one per rule  |
| RPKI                         | ✅                      | ❌                         | ❌                       | ✅                    | ❌               |
| BGP roles (RFC 9234)         | ✅                      | ❌                         | ❌                       | ❌                    | ❌               |
| GTSM (RFC 5082)              | ✅ eBGP                 | ❌                         | ❌                       | ❌                    | ❌               |
| Route reflection (RFC 4456)  | ✅                      | ✅                         | ❌                       | ✅                    | ✅               |
| Confederations (RFC 5065)    | ❌                      | ❌                         | ❌                       | ✅                    | ✅               |
| Graceful restart (RFC 4724)  | ❌                      | ❌                         | ❌                       | ✅ all or no sessions | ✅               |
| Prefix limit that restarts   | ❌                      | ✅ whole minutes           | ❌                       | ✅ whole minutes      | ❌               |
| Prefix limit that only warns | ❌                      | ❌                         | ❌                       | ✅                    | ✅               |
| Default route to a neighbor  | ✅                      | ❌                         | ❌                       | ✅                    | ✅               |
| BGP aggregates               | ❌                      | ❌                         | ❌                       | ✅                    | ✅               |

### Firewall and services

| Feature                            | RouterOS                 | VRP                   | Raisecom ROS               | Junos                    | FortiOS                                         |
| ---------------------------------- | ------------------------ | --------------------- | -------------------------- | ------------------------ | ----------------------------------------------- |
| Firewall filter                    | ✅                       | ❌                    | ❌                         | ❌                       | ✅                                              |
| NAT                                | ✅                       | ❌                    | ❌                         | ❌                       | IPv4                                            |
| CGNAT pool, deterministic          | ✅                       | ❌                    | ❌                         | ❌                       | ❌                                              |
| CGNAT pool, dynamic                | ❌                       | ❌                    | ❌                         | ❌                       | ✅ 64 to 4096 ports in a block, 1 to 128 blocks |
| TCP MSS clamp                      | ✅                       | ❌                    | ❌                         | ❌                       | ❌                                              |
| DSCP and PCP marking               | ✅ not with fast path    | 🧪 DSCP only          | ❌                         | ❌                       | ❌                                              |
| Classes and schedulers             | ✅ not with fast path    | ❌                    | ❌                         | ❌                       | ❌                                              |
| DHCP server                        | ✅                       | 🧪                    | ❌                         | ✅                       | ✅                                              |
| DHCPv6 server                      | ✅ pool is a prefix      | ❌                    | ❌                         | ✅ not DNS servers alone | ✅ needs `pool`; 🧪 delegated prefixes          |
| DHCP relay                         | ✅                       | IPv4, VLAN interfaces | ❌                         | IPv4                     | ✅                                              |
| DHCP server in a VRF               | ✅                       | 🧪                    | ❌                         | 🧪                       | 🧪                                              |
| DHCP leases checked by RADIUS      | ✅ one RADIUS setting    | ❌                    | ❌                         | ❌                       | ❌                                              |
| PPPoE server                       | ✅ one RADIUS setting    | ❌                    | ❌                         | ❌                       | ❌                                              |
| Delegated IPv6 prefixes over PPPoE | ✅ from a pool or RADIUS | ❌                    | ❌                         | ❌                       | ❌                                              |
| DNS server                         | ✅                       | ❌                    | ❌                         | ❌                       | ✅                                              |
| NTP client                         | ✅                       | ✅                    | ✅                         | ✅                       | ✅                                              |
| NTP server                         | ✅                       | ✅                    | always, with an NTP client | ✅                       | ✅                                              |

Marking is refused on RouterOS beside a `fast_path` rule, and with `system.hardware_offload` unless the rule matches a VLAN interface with `hardware_offload: false` in `in_interface` or `out_interface`: traffic on the fast path or offloaded skips it. The other platforms don't build marking:

- **Junos.** A QFX5100 marks in a filter on each interface where traffic arrives. That filter also marks what goes to the switch itself, can't match the interface a packet leaves through, and can't set a PCP.
- **FortiOS.** A DSCP is set for a whole session, in the firewall policy or the shaping policy the session takes. A session takes one shaping policy, and rate limits already use them.
- **VRP.** Marking is Huawei's MQC: an ACL and a traffic classifier for each rule, and a traffic policy for each family, applied to all the switch receives. Huawei's reference has `remark dscp` work only on what the switch routes, as marking means. `remark 8021p` works only on what it switches, so VRP refuses `pcp`. A CE6855 took the policies on a spare port, but no packet was seen marked, so marking stays experimental.
- **Raisecom ROS.** Not built yet.

A scheduler on RouterOS needs its `rate`, and each strict queue its `max`. RouterOS queues with HTB, which gives each queue the rate it keeps for it first, then lends what is left by priority. So a strict queue keeps its `max` and goes first, and a weighted queue keeps its share of the rate less the strict queues' `max`. A scheduler is refused on a switched port, whose routed packets leave through the VLAN interface. It is refused beside a `fast_path` rule, and with `system.hardware_offload` unless on a VLAN interface with `hardware_offload: false`, as packets there skip the queues. Junos, FortiOS, VRP, and Raisecom ROS don't build classes and schedulers yet.

### Management and monitoring

| Feature                           | RouterOS                        | VRP                             | Raisecom ROS      | Junos                  | FortiOS                           |
| --------------------------------- | ------------------------------- | ------------------------------- | ----------------- | ---------------------- | --------------------------------- |
| Users                             | ✅                              | ✅                              | `admin` role only | ✅                     | ✅                                |
| SSH keys                          | ✅                              | one RSA key per user            | ❌                | ✅                     | ✅                                |
| Logins through servers            | RADIUS, no command accounting   | no command accounting on RADIUS | ❌                | ✅                     | ✅ up to 3 servers, no accounting |
| SNMP v2c and v3                   | ✅ v3 SHA1 only                 | ✅                              | ✅ v3 SHA1 only   | ✅                     | ✅ v3 SHA1 only                   |
| SNMP traps                        | one community or user, port 162 | ❌                              | ❌                | ✅                     | ✅                                |
| Syslog                            | ✅                              | ✅                              | ✅                | ✅                     | ✅ up to 4                        |
| Syslog over TLS                   | ❌                              | ❌                              | ❌                | ❌                     | 🧪                                |
| Flow export                       | NetFlow 9, IPFIX                | sFlow                           | ❌                | sFlow                  | sFlow, NetFlow 9                  |
| Flow timeouts                     | ✅                              | ❌                              | ❌                | ❌                     | 🧪                                |
| ICMP probes                       | ✅                              | ❌                              | ❌                | 🧪                     | ✅ not in a VRF                   |
| Web, API, certificates            | ✅                              | ❌                              | ❌                | web, API               | ✅                                |
| Management in a VRF               | ✅ not FTP                      | ❌                              | ❌                | ❌                     | ❌                                |
| SNMP in a VRF                     | ✅                              | ❌                              | ❌                | ❌                     | ❌                                |
| NTP, DNS, syslog, RADIUS in a VRF | ✅                              | ❌                              | ❌                | syslog; 🧪 NTP, RADIUS | ❌                                |
| Management VDOM                   | ❌                              | ❌                              | ❌                | ❌                     | ✅                                |

### Circuit's own tools

| Tool                                                           | RouterOS | VRP | Raisecom ROS | Junos | FortiOS |
| -------------------------------------------------------------- | -------- | --- | ------------ | ----- | ------- |
| `diff`, `apply`                                                | ✅       | ✅  | ✅           | ✅    | ✅      |
| Serial console (`access-console`)                              | ✅       | ✅  | ✅           | ✅    | ✅      |
| LLDP check while connected                                     | ✅       | ✅  | ✅           | ✅    | ✅      |
| `circuit bgp`, live BGP sessions                               | ✅       | ❌  | ❌           | 🧪    | 🧪      |
| [Health check](/guide/apply#checking-afterwards) after `apply` | ✅       | ❌  | ❌           | 🧪    | 🧪      |

If your device can do something that this table doesn't show, see [Contributing](/contributing).
