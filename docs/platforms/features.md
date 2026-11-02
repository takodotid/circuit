---
description: Which feature works on which device OS, at a glance.
---

# Feature matrix

What each platform can do today.

| Mark | Means                                                                                                                    |
| ---- | ------------------------------------------------------------------------------------------------------------------------ |
| ✅   | Works. Proved on a real device.                                                                                          |
| ❌   | Not on this platform. `circuit validate` stops you.                                                                      |
| 🧪   | Not proved on a real device yet. Circuit stops, unless you add `--experimental`: then it's a warning, and yours to test. |

A note in a cell means "works, with this limit".

## Switching

| Feature             | RouterOS      | VRP           | Raisecom ROS      | Junos | FortiOS             |
| ------------------- | ------------- | ------------- | ----------------- | ----- | ------------------- |
| VLANs, access/trunk | ✅            | ✅            | ✅                | ✅    | ✅ VLAN interfaces  |
| LAG                 | ✅            | ✅            | ✅                | ✅    | ✅                  |
| STP                 | ✅            | ✅            | off only          | ✅    | ❌ ports are routed |
| Storm control       | ✅ in percent | ✅ in percent | broadcast, in pps | ✅    | ❌                  |
| MAC limit           | ❌            | ✅ ports      | ✅ ports          | ✅    | ❌                  |
| Ethertype filter    | ✅ ports      | ✅ ports      | ✅ ports          | ✅    | ❌                  |
| Hardware ACLs       | ✅            | ❌            | ❌                | ✅    | ✅ drop rules only  |
| LLDP                | ✅            | ✅            | ✅                | ✅    | ✅                  |
| Bridge interface    | ❌            | ❌            | ❌                | ❌    | ✅                  |

## Interfaces

| Feature                   | RouterOS | VRP  | Raisecom ROS | Junos | FortiOS |
| ------------------------- | -------- | ---- | ------------ | ----- | ------- |
| VLAN interface            | ✅       | ✅   | ✅           | ✅    | ✅      |
| Routed port, loopback     | ✅       | ❌   | ❌           | ✅    | ✅      |
| GRE                       | ✅       | ❌   | ❌           | ✅    | ✅      |
| VXLAN                     | ✅       | ❌   | ❌           | ❌    | ✅      |
| WireGuard                 | ✅       | ❌   | ❌           | ❌    | ❌      |
| VRRP                      | ✅       | IPv4 | IPv4         | IPv4  | IPv4    |
| IPv6 router advertisement | ✅       | ❌   | ❌           | ✅    | ✅      |

## Routing

| Feature                     | RouterOS | VRP  | Raisecom ROS  | Junos        | FortiOS          |
| --------------------------- | -------- | ---- | ------------- | ------------ | ---------------- |
| Static routes               | ✅       | ✅   | IPv4 next hop | ✅           | ✅               |
| VRFs                        | ✅       | ✅   | ❌            | ✅           | ✅               |
| Policy routing, more tables | ✅       | 🧪   | 🧪            | 🧪           | 🧪               |
| OSPF                        | ✅       | IPv4 | IPv4          | outside VRFs | outside VRFs     |
| BFD                         | ✅       | ✅   | static routes | ✅           | ✅               |
| BGP                         | ✅       | ❌   | ❌            | ✅           | ✅               |
| Route policies, prefix sets | ✅       | ❌   | ❌            | ✅           | ✅               |
| BGP communities             | ✅       | ❌   | ❌            | ✅           | ✅ no large ones |
| RPKI                        | ✅       | ❌   | ❌            | ✅           | ❌               |

## Firewall and services

| Feature         | RouterOS | VRP             | Raisecom ROS | Junos | FortiOS |
| --------------- | -------- | --------------- | ------------ | ----- | ------- |
| Firewall filter | ✅       | ❌              | ❌           | ❌    | ✅      |
| NAT             | ✅       | ❌              | ❌           | ❌    | IPv4    |
| DHCP server     | ✅       | ❌              | ❌           | IPv4  | ✅      |
| DHCP relay      | ✅       | VLAN interfaces | ❌           | IPv4  | ✅      |
| DNS server      | ✅       | ❌              | ❌           | ❌    | ✅      |
| NTP client      | ✅       | ✅              | ✅           | ✅    | ✅      |
| NTP server      | ✅       | ✅              | ❌           | ✅    | ✅      |

## Management and monitoring

| Feature                | RouterOS         | VRP   | Raisecom ROS   | Junos    | FortiOS          |
| ---------------------- | ---------------- | ----- | -------------- | -------- | ---------------- |
| Users                  | ✅               | ✅    | admin role     | ✅       | ✅               |
| SSH keys               | ✅               | ❌    | ❌             | ✅       | ✅               |
| SNMP v2c and v3        | ✅ v3 SHA1/MD5   | ✅    | ✅ v3 SHA1/MD5 | ✅       | ✅ v3 SHA1/MD5   |
| Syslog                 | ✅               | ✅    | ✅             | ✅       | ✅ up to 4       |
| Flow export            | NetFlow 9, IPFIX | sFlow | ❌             | sFlow    | sFlow, NetFlow 9 |
| Web, API, certificates | ✅               | ❌    | ❌             | web, API | ✅               |

## Circuit's own tools

| Tool                              | RouterOS | VRP | Raisecom ROS | Junos | FortiOS |
| --------------------------------- | -------- | --- | ------------ | ----- | ------- |
| `diff`, `apply`                   | ✅       | ✅  | ✅           | ✅    | ✅      |
| Serial console (`access-console`) | ✅       | ✅  | ✅           | ✅    | ✅      |
| LLDP check while connected        | ✅       | ✅  | ✅           | ✅    | ✅      |
| `circuit bgp`, live BGP sessions  | ✅       | ❌  | ❌           | ❌    | ❌      |
| Health check after `apply`        | ✅       | ❌  | ❌           | ❌    | ❌      |

## How this table is made

From Circuit's code, not from datasheets. ✅ is built and tested against a real device's output. ❌ and 🧪 are what Circuit refuses.

Something missing that your device can do? See [Contributing](/contributing).
