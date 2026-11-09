---
description: The device operating systems Circuit talks to, the versions, and what works on each.
---

# Platforms

A platform is the device's operating system. It decides which commands Circuit sends.

| `platform`     | OS                | Version  | Tested on                                                      |
| -------------- | ----------------- | -------- | -------------------------------------------------------------- |
| `routeros`     | MikroTik RouterOS | 7        | CCR2216-1G-12XS-2XQ, RouterOS 7.23; RB5009UG+S+, RouterOS 7.24 |
| `vrp`          | Huawei VRP        | V200R005 | CE6855-48S6Q-HI, V200R005C00SPC800                             |
| `raisecom-ros` | Raisecom ROS      | 6.5      | RAX721-C-6C48, ROS 6.5.2                                       |
| `junos`        | Juniper Junos     | 21       | QFX5100-48S-6Q, Junos 21.4R3                                   |
| `fortios`      | Fortinet FortiOS  | 6.2      | FG-3700D, FortiOS 6.2.2                                        |

Good to know:

- **One version per platform.** `routeros` means RouterOS 7. RouterOS 6 takes other commands, so it's not supported.
- **Version check.** RouterOS, Junos and FortiOS stop `diff` and `apply` on another version. VRP and Raisecom don't check, so check it yourself before the first apply.
- **Only the models it was tested on.** Another model needs its port list added; see [Contributing](/contributing).

The whole picture is in the [feature matrix](/platforms/features).

## RouterOS

**Works:** switching, LAG, routed ports, GRE, VXLAN, WireGuard, VRRP, VRFs, policy routing, OSPF, BFD, BGP with policies, communities and RPKI, firewall, NAT, hardware ACLs, DHCP, DNS and NTP servers, NetFlow/IPFIX, `circuit bgp`, and a health check after each apply.

**Doesn't:** MAC limit (RouterOS 7.23 has none), bridge interfaces, SNMPv3 with SHA-256, BFD on a static route.

**Watch out:** the CCR2216 takes at most 8 ports in a LAG, and about 5 different port ranges in its hardware ACLs. `circuit validate` checks both. The RB5009 has no serial console, so `connection.console` is refused there. After an apply, check no switch rule is invalid:

```text
/interface ethernet switch rule print count-only where invalid
```

## VRP

**Works:** VLANs, LAG, VLAN interfaces, VRRP (IPv4), VRFs, static routes, OSPF (IPv4), BFD, DHCP relay, NTP, SNMP, syslog, sFlow, MAC limit and ethertype filter on ports, one RSA SSH key per user.

**Doesn't:** BGP, route policies, firewall, NAT, hardware ACLs, DHCP server, loopbacks and tunnels, ed25519 or ECDSA SSH keys.

**Not built yet:** policy routing, MAC limit and ethertype filter on a LAG.

## Raisecom ROS

**Works:** VLANs, LAG, VLAN interfaces (IPv4), VRRP (IPv4), static routes (IPv4 next hop), OSPF (IPv4), BFD on static routes, SNMP, syslog, MAC limit and ethertype filter on ports.

**Doesn't:** BGP, VRFs, firewall, ACLs, DHCP, DNS and NTP servers, flow export, STP other than off, users other than admin.

**Not built yet:** BFD timers, policy routing.

## Junos

**Works:** switching, MAC limit, ethertype filter, ports bound to their hosts, hardware ACLs, LAG, routed ports, loopbacks, GRE, VRRP (IPv4), VRFs, OSPF, BFD, BGP with policies, communities and RPKI, DHCP (IPv4), sFlow, SSH keys.

**Doesn't:** firewall filter and NAT, VXLAN, WireGuard, DNS server, BGP roles.

**Not built yet:** policy routing.

## FortiOS

**Works:** VLAN interfaces, LAG, bridges, routed ports, GRE, VXLAN, VRRP (IPv4), VRFs, OSPF, BFD (on a VRF's static route too), BGP with policies and communities, firewall, NAT (IPv4), drop-only ACLs, DHCP, DNS and NTP servers, sFlow and NetFlow 9, a management VDOM.

**Doesn't:** STP, storm control, MAC limit (ports are routed), WireGuard, RPKI, large communities, BGP roles.

**Not built yet:** policy routing.
