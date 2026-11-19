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

## Feature matrix

The table comes from Circuit's code, not from datasheets. [Standards](/reference/standards) lists the RFC behind each feature.

| Mark | Means                                                                                                                                                               |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ✅   | Works, and tested on a real device.                                                                                                                                 |
| ❌   | Not on this platform, or not built yet. Circuit stops you.                                                                                                          |
| 🧪   | Built from the vendor's documentation, but not tested on a real device yet. Circuit stops, unless you add `--experimental`. Then it's a warning, and yours to test. |

A note in a cell means "works, with this limit".

### Switching

| Feature             | RouterOS      | VRP           | Raisecom ROS      | Junos | FortiOS             |
| ------------------- | ------------- | ------------- | ----------------- | ----- | ------------------- |
| VLANs, access/trunk | ✅            | ✅            | ✅                | ✅    | ✅ VLAN interfaces  |
| LAG                 | ✅            | ✅            | ✅                | ✅    | ✅                  |
| STP                 | ✅            | ✅            | off only          | ✅    | ❌ ports are routed |
| Storm control       | ✅ in percent | ✅ in percent | broadcast, in pps | ✅    | ❌                  |
| MAC limit           | ❌            | ✅ ports      | ✅ ports          | ✅    | ❌                  |
| Ethertype filter    | ✅ ports      | ✅ ports      | ✅ ports          | ✅    | ❌                  |
| Port bound to hosts | ❌            | ❌            | ❌                | ✅    | ❌                  |
| Hardware ACLs       | ✅            | ❌            | ❌                | ✅    | ✅ drop rules only  |
| LLDP                | ✅            | ✅            | ✅                | ✅    | ✅                  |
| Bridge interface    | ❌            | ❌            | ❌                | ❌    | ✅                  |

### Interfaces

| Feature                    | RouterOS                                                | VRP            | Raisecom ROS | Junos     | FortiOS                          |
| -------------------------- | ------------------------------------------------------- | -------------- | ------------ | --------- | -------------------------------- |
| VLAN interface             | ✅                                                      | ✅             | ✅           | ✅        | ✅                               |
| Routed port, loopback      | ✅                                                      | ❌             | ❌           | ✅        | ✅                               |
| GRE                        | ✅                                                      | ❌             | ❌           | ✅        | ✅                               |
| VXLAN                      | ✅                                                      | ❌             | ❌           | ❌        | ✅                               |
| WireGuard                  | ✅                                                      | ❌             | ❌           | ❌        | ❌                               |
| EoIP                       | ✅                                                      | ❌             | ❌           | ❌        | ❌                               |
| Round-robin LAG, ARP check | ✅                                                      | ❌             | ❌           | ❌        | ❌                               |
| Shaping (CAKE)             | ✅                                                      | ❌             | ❌           | ❌        | ❌                               |
| Proxy ARP for an address   | ❌                                                      | ❌             | ❌           | ❌        | ✅                               |
| VRRP                       | ✅                                                      | IPv4           | IPv4         | IPv4      | IPv4                             |
| IPv6 router advertisement  | ✅ no search domains                                    | ❌             | ❌           | ✅        | ✅                               |
| uRPF (RFC 3704)            | ✅ IPv4, one mode for the router; 🧪 strict beside VRFs | 🧪 loose, IPv4 | ❌           | ✅ strict | 🧪 strict, one mode for the VDOM |

### Routing

| Feature                      | RouterOS                | VRP        | Raisecom ROS             | Junos                 | FortiOS          |
| ---------------------------- | ----------------------- | ---------- | ------------------------ | --------------------- | ---------------- |
| Static routes                | ✅                      | ✅         | IPv4 next hop            | ✅                    | ✅               |
| Next hop with its interface  | ✅                      | ❌         | ❌                       | ❌                    | ✅               |
| VRFs                         | ✅                      | ✅         | ❌                       | ✅                    | ✅               |
| Policy routing, more tables  | ✅                      | ❌ not yet | ❌ not yet               | ❌ not yet            | ❌ not yet       |
| OSPF                         | ✅                      | IPv4       | IPv4                     | outside VRFs          | outside VRFs     |
| OSPF stub and NSSA areas     | ✅                      | 🧪         | ❌                       | ✅                    | ✅               |
| OSPF hello and dead timers   | ✅                      | 🧪         | ❌                       | ✅                    | ✅               |
| OSPF authentication          | ✅                      | 🧪         | ❌                       | MD5                   | MD5              |
| BFD                          | ✅ not on static routes | ✅         | static routes, no timers | ✅                    | ✅               |
| BGP                          | ✅                      | ❌         | ❌                       | ✅                    | ✅               |
| Route policies, prefix sets  | ✅                      | ❌         | ❌                       | ✅                    | ✅               |
| BGP communities              | ✅                      | ❌         | ❌                       | ✅                    | ✅ no large ones |
| AS path matches              | ✅                      | ❌         | ❌                       | ✅ 21.3 or later      | 🧪 one per rule  |
| RPKI                         | ✅                      | ❌         | ❌                       | ✅                    | ❌               |
| BGP roles (RFC 9234)         | ✅                      | ❌         | ❌                       | ❌                    | ❌               |
| GTSM (RFC 5082)              | ✅ eBGP                 | ❌         | ❌                       | ❌                    | ❌               |
| Route reflection (RFC 4456)  | ✅                      | ❌         | ❌                       | ✅                    | ✅               |
| Graceful restart (RFC 4724)  | ❌                      | ❌         | ❌                       | ✅ all or no sessions | ✅               |
| Prefix limit that restarts   | ❌                      | ❌         | ❌                       | ✅ whole minutes      | ❌               |
| Prefix limit that only warns | ❌                      | ❌         | ❌                       | ✅                    | ✅               |
| Default route to a neighbor  | ✅                      | ❌         | ❌                       | ✅                    | ✅               |
| BGP aggregates               | ❌                      | ❌         | ❌                       | ✅                    | ✅               |

### Firewall and services

| Feature         | RouterOS | VRP             | Raisecom ROS | Junos | FortiOS |
| --------------- | -------- | --------------- | ------------ | ----- | ------- |
| Firewall filter | ✅       | ❌              | ❌           | ❌    | ✅      |
| NAT             | ✅       | ❌              | ❌           | ❌    | IPv4    |
| TCP MSS clamp   | ✅       | ❌              | ❌           | ❌    | ❌      |
| DHCP server     | ✅       | ❌              | ❌           | IPv4  | ✅      |
| DHCP relay      | ✅       | VLAN interfaces | ❌           | IPv4  | ✅      |
| DNS server      | ✅       | ❌              | ❌           | ❌    | ✅      |
| NTP client      | ✅       | ✅              | ✅           | ✅    | ✅      |
| NTP server      | ✅       | ✅              | ❌           | ✅    | ✅      |

### Management and monitoring

| Feature                | RouterOS                      | VRP                  | Raisecom ROS      | Junos    | FortiOS                           |
| ---------------------- | ----------------------------- | -------------------- | ----------------- | -------- | --------------------------------- |
| Users                  | ✅                            | ✅                   | `admin` role only | ✅       | ✅                                |
| SSH keys               | ✅                            | one RSA key per user | ❌                | ✅       | ✅                                |
| Logins through servers | RADIUS, no command accounting | ❌                   | ❌                | ✅       | ✅ up to 3 servers, no accounting |
| SNMP v2c and v3        | ✅ v3 SHA1 only               | ✅                   | ✅ v3 SHA1 only   | ✅       | ✅ v3 SHA1 only                   |
| Syslog                 | ✅                            | ✅                   | ✅                | ✅       | ✅ up to 4                        |
| Flow export            | NetFlow 9, IPFIX              | sFlow                | ❌                | sFlow    | sFlow, NetFlow 9                  |
| Web, API, certificates | ✅                            | ❌                   | ❌                | web, API | ✅                                |
| Management VDOM        | ❌                            | ❌                   | ❌                | ❌       | ✅                                |

### Circuit's own tools

| Tool                                                           | RouterOS | VRP | Raisecom ROS | Junos | FortiOS |
| -------------------------------------------------------------- | -------- | --- | ------------ | ----- | ------- |
| `diff`, `apply`                                                | ✅       | ✅  | ✅           | ✅    | ✅      |
| Serial console (`access-console`)                              | ✅       | ✅  | ✅           | ✅    | ✅      |
| LLDP check while connected                                     | ✅       | ✅  | ✅           | ✅    | ✅      |
| `circuit bgp`, live BGP sessions                               | ✅       | ❌  | ❌           | ❌    | ❌      |
| [Health check](/guide/apply#checking-afterwards) after `apply` | ✅       | ❌  | ❌           | ❌    | ❌      |

If your device can do something that this table doesn't show, see [Contributing](/contributing).
