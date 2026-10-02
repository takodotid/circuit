# Platforms

| Platform       | Operating system    | Proved on           |
| -------------- | ------------------- | ------------------- |
| `routeros`     | MikroTik RouterOS 7 | CCR2216-1G-12XS-2XQ |
| `vrp`          | Huawei VRP          | CE6855-48S6Q-HI     |
| `raisecom-ros` | Raisecom ROS        | RAX721-C-6C48       |

Not every platform can express every field. What one cannot is reported by `validate`, never skipped:

| Feature                                   | routeros              | vrp                   | raisecom-ros            |
| ----------------------------------------- | --------------------- | --------------------- | ----------------------- |
| VLANs, access and trunk ports, links      | yes                   | yes                   | yes                     |
| Per-port STP, storm control, LLDP         | yes, storm in percent | yes, storm in percent | off only, broadcast pps |
| LAGs                                      | yes                   | yes                   | no                      |
| Routed ports, loopbacks, tunnels          | yes                   | VLAN interfaces only  | VLAN interfaces only    |
| VRRP, VRFs, DHCP relay                    | yes                   | IPv4                  | no                      |
| Static routes                             | yes                   | yes                   | IPv4 next hop           |
| OSPF and BFD                              | yes                   | IPv4                  | no                      |
| BGP, policies, prefix sets, RPKI          | yes                   | no                    | no                      |
| Firewall, NAT, hardware ACLs, DHCP server | yes                   | no                    | no                      |
| Flow export                               | NetFlow 9, IPFIX      | sFlow                 | no                      |
| SNMP                                      | v2c, v3 with SHA1     | v2c, v3               | v2c                     |
| Certificates, web and API                 | yes                   | no                    | no                      |

Each platform's page lists the behaviour its adapter works around. Every item there was hit on a real device.
