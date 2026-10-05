# Platforms

A platform is a device's operating system. It decides which commands Circuit sends, and what the device can do.

| Platform       | Operating system    | Proved on           |
| -------------- | ------------------- | ------------------- |
| `routeros`     | MikroTik RouterOS 7 | CCR2216-1G-12XS-2XQ |
| `vrp`          | Huawei VRP          | CE6855-48S6Q-HI     |
| `raisecom-ros` | Raisecom ROS        | RAX721-C-6C48       |

Each platform supports one hardware model so far, the one it was proved on. Another model of the same platform needs its port layout added to the platform's `models.ts`; see [Contributing](/contributing#adding-a-platform).

## What each platform can do

Not every device can do everything. If you write a field the device's platform cannot do, `circuit validate` reports it as an error and nothing is sent to that device. Circuit never skips a field quietly.

| Feature                                   | routeros              | vrp                   | raisecom-ros            |
| ----------------------------------------- | --------------------- | --------------------- | ----------------------- |
| VLANs, access and trunk ports, links      | yes                   | yes                   | yes                     |
| Per-port STP, storm control, LLDP         | yes, storm in percent | yes, storm in percent | off only, broadcast pps |
| LAGs                                      | yes                   | yes                   | yes                     |
| Routed ports, loopbacks, tunnels          | yes                   | VLAN interfaces only  | VLAN interfaces only    |
| VRRP, VRFs, DHCP relay                    | yes                   | IPv4                  | VRRP, IPv4              |
| Static routes                             | yes                   | yes                   | IPv4 next hop           |
| OSPF and BFD                              | yes                   | IPv4                  | OSPF, IPv4              |
| BGP, policies, prefix sets, RPKI          | yes                   | no                    | no                      |
| Firewall, NAT, hardware ACLs, DHCP server | yes                   | no                    | no                      |
| Flow export                               | NetFlow 9, IPFIX      | sFlow                 | no                      |
| SNMP                                      | v2c, v3 with SHA1     | v2c, v3               | v2c, v3 with SHA1       |
| Certificates, web and API                 | yes                   | no                    | no                      |

Each platform's own page lists the device's surprises that Circuit works around, so you do not have to. Every one of them was found on a real device.
