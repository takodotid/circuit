# Platforms

A platform is a device's operating system. It decides which commands Circuit sends, and what the device can do.

| Platform       | Operating system     | Proved on           |
| -------------- | -------------------- | ------------------- |
| `routeros`     | MikroTik RouterOS 7  | CCR2216-1G-12XS-2XQ |
| `vrp`          | Huawei VRP           | CE6855-48S6Q-HI     |
| `raisecom-ros` | Raisecom ROS         | RAX721-C-6C48       |
| `junos`        | Juniper Junos 21     | QFX5100-48S-6Q      |
| `fortios`      | Fortinet FortiOS 6.2 | FG-3700D            |

Each platform supports one hardware model so far, the one it was proved on. Another model of the same platform needs its port layout added to the platform's `models.ts`; see [Contributing](/contributing#adding-a-platform).

## What each platform can do

A field a platform cannot do is an error, never skipped; see [Devices](/guide/devices#when-a-device-cannot-do-what-you-wrote).

| Feature                                   | routeros              | vrp                      | raisecom-ros            | junos                             | fortios                                       |
| ----------------------------------------- | --------------------- | ------------------------ | ----------------------- | --------------------------------- | --------------------------------------------- |
| VLANs, access and trunk ports, links      | yes                   | yes                      | yes                     | yes                               | VLAN interfaces on a routed port or LAG       |
| Per-port STP, storm control, LLDP         | yes, storm in percent | yes, storm in percent    | off only, broadcast pps | yes, storm in percent             | LLDP                                          |
| LAGs                                      | yes                   | yes                      | yes                     | yes                               | yes                                           |
| Routed ports, loopbacks, tunnels          | yes                   | VLAN interfaces only     | VLAN interfaces only    | yes, GRE tunnels                  | yes, GRE and VXLAN                            |
| VRRP, VRFs, DHCP relay                    | yes                   | IPv4                     | VRRP, IPv4              | IPv4 VRRP and relay               | IPv4 VRRP, VRFs, relay                        |
| Static routes                             | yes                   | IPv6 without description | IPv4 next hop           | without description               | yes                                           |
| IPv6 router advertisements                | yes                   | no                       | no                      | yes                               | yes                                           |
| OSPF and BFD                              | yes                   | IPv4                     | OSPF, IPv4              | outside VRFs                      | outside VRFs                                  |
| BGP, policies, prefix sets, RPKI          | yes                   | no                       | no                      | yes, without roles                | yes, without RPKI, roles or large communities |
| Firewall, NAT, hardware ACLs, DHCP server | yes                   | no                       | no                      | hardware ACLs, DHCP server        | yes, ACLs that drop, NAT for IPv4             |
| Flow export                               | NetFlow 9, IPFIX      | sFlow                    | no                      | sFlow                             | sFlow, NetFlow 9, one collector               |
| SNMP                                      | v2c, v3 with SHA1     | v2c, v3                  | v2c, v3 with SHA1       | v2c, v3                           | v2c, v3 with SHA1                             |
| Certificates, web and API                 | yes                   | no                       | no                      | web, API and NETCONF, without TLS | certificates and web                          |

Each platform's own page lists the device's surprises that Circuit works around, so you do not have to. Every one of them was found on a real device.
