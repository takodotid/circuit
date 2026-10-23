# Platforms

A platform is a device's operating system. It decides which commands Circuit sends, and what the device can do.

| Platform       | Operating system  | Versions | Version checked | Proved on                          |
| -------------- | ----------------- | -------- | --------------- | ---------------------------------- |
| `routeros`     | MikroTik RouterOS | 7        | yes             | CCR2216-1G-12XS-2XQ, RouterOS 7.23 |
| `vrp`          | Huawei VRP        | V200R005 | no              | CE6855-48S6Q-HI, V200R005C00SPC800 |
| `raisecom-ros` | Raisecom ROS      | 6.5      | no              | RAX721-C-6C48, ROS 6.5.2           |
| `junos`        | Juniper Junos     | 21       | yes             | QFX5100-48S-6Q, Junos 21.4R3       |
| `fortios`      | Fortinet FortiOS  | 6.2      | yes             | FG-3700D, FortiOS 6.2.2            |

A platform is one operating system at the versions in the table, not every version of it. `routeros` is RouterOS 7: RouterOS 6 takes other commands, so it isn't supported. Where the version is checked, `snapshot` and `apply` stop on a device that runs another version. Where it isn't, nothing stops you, so check the version yourself before the first apply.

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
