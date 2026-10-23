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

## Model limits

Some hardware holds less than its datasheet says. Where a real device showed it, the model lists the limit in its platform's `models.ts`, and `circuit validate` checks every device of that model against it:

| Model                 | Limit                                  | Found by                                     | `validate` gives |
| --------------------- | -------------------------------------- | -------------------------------------------- | ---------------- |
| `CCR2216-1G-12XS-2XQ` | At most 8 member ports in a LAG        | 12 active members crash-looped the router    | an error         |
| `CCR2216-1G-12XS-2XQ` | About 50 switch rules                  | the chip held about 50, not the 1,024 listed | a warning        |
| `CCR2216-1G-12XS-2XQ` | 5 distinct port ranges in switch rules | the sixth distinct range was invalid         | a warning        |

A switch rule is one entry in the switch chip's hardware ACL. RouterOS makes one for each ACL rule on each port that has the ACL, and one for each port or range in a rule's `src_port` or `dst_port` list, so 20 ACL rules on three ports are 60 switch rules. Circuit counts a range such as `{ min: 0, max: 1023 }` once, however many rules use it, in `src_port` or `dst_port` alike. When the chip cannot hold a rule, that rule and every rule after it stop working, without a log line. The switch rule limits are a warning because the count is rough: after an apply, check that no rule is invalid with `/interface ethernet switch rule print count-only where invalid`.

## What each platform can do

A field a platform cannot do is an error, never skipped; see [Devices](/guide/devices#when-a-device-cannot-do-what-you-wrote).

"Not yet" means the field exists, but no device has shown yet how it takes and prints the commands, so `validate` refuses it until someone proves it on one.

| Feature                                       | routeros              | vrp                      | raisecom-ros            | junos                             | fortios                                       |
| --------------------------------------------- | --------------------- | ------------------------ | ----------------------- | --------------------------------- | --------------------------------------------- |
| VLANs, access and trunk ports, links          | yes                   | yes                      | yes                     | yes                               | VLAN interfaces on a routed port or LAG       |
| Per-port STP, storm control, LLDP             | yes, storm in percent | yes, storm in percent    | off only, broadcast pps | yes, storm in percent             | LLDP                                          |
| MAC limit, ethertype filter                   | not yet               | not yet                  | not yet                 | not yet                           | not yet                                       |
| LLDP neighbors, read by `snapshot`            | not yet               | not yet                  | not yet                 | not yet                           | not yet                                       |
| LAGs                                          | yes                   | yes                      | yes                     | yes                               | yes                                           |
| Routed ports, loopbacks, tunnels              | yes                   | VLAN interfaces only     | VLAN interfaces only    | yes, GRE tunnels                  | yes, GRE and VXLAN                            |
| VRRP, VRFs, DHCP relay                        | yes                   | IPv4                     | VRRP, IPv4              | IPv4 VRRP and relay               | IPv4 VRRP, VRFs, relay                        |
| Static routes                                 | yes                   | IPv6 without description | IPv4 next hop           | without description               | yes                                           |
| IPv6 router advertisements                    | yes                   | no                       | no                      | yes                               | yes                                           |
| OSPF and BFD                                  | yes                   | IPv4                     | OSPF, IPv4              | outside VRFs                      | outside VRFs                                  |
| BFD timers, on static routes and multihop BGP | not yet               | not yet                  | not yet                 | not yet                           | not yet                                       |
| BGP, policies, prefix sets, RPKI              | yes                   | no                       | no                      | yes, without roles                | yes, without RPKI, roles or large communities |
| Firewall, NAT, hardware ACLs, DHCP server     | yes                   | no                       | no                      | hardware ACLs, DHCP server        | yes, ACLs that drop, NAT for IPv4             |
| Flow export                                   | NetFlow 9, IPFIX      | sFlow                    | no                      | sFlow                             | sFlow, NetFlow 9, one collector               |
| SNMP                                          | v2c, v3 with SHA1     | v2c, v3                  | v2c, v3 with SHA1       | v2c, v3                           | v2c, v3 with SHA1                             |
| Sources per service, such as `snmp.allow`     | yes                   | `management.allow` only  | `management.allow` only | yes                               | yes                                           |
| Logging, kept and sent to collectors          | yes                   | not yet                  | not yet                 | yes, files rotate by size         | yes, kept in memory, up to 4 collectors       |
| Certificates, web and API                     | yes                   | no                       | no                      | web, API and NETCONF, without TLS | certificates and web                          |
| An alarm's severity, by name                  | not yet               | not yet                  | not yet                 | not yet                           | not yet                                       |

Each platform's own page lists the device's surprises that Circuit works around, so you do not have to. Every one of them was found on a real device.
