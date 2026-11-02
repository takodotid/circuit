# Standards Circuit v1 follows

What the v1 model writes or checks, and the standard behind it. Checked on 2026-11-01 against `src/config/` (then the design prototype), [the model](../docs/reference/model.md) and the Circuit 0.43 renderers (`src/platforms/*`), and each RFC's status at the RFC Editor.

- **In model**: the field, preset or check that carries it.
- **Rendered**: the platforms whose 0.43 renderer writes it: ROS (RouterOS), JUN (Junos), VRP, FOS (FortiOS), RCM (Raisecom ROS). "Circuit itself" means Circuit uses it and no device sees it.
- **Practice** marks a published practice or an Informational RFC, not a standard.

## Routing

| Feature                                                        | Standard                                                                                                                 | In model                                                          | Rendered (platforms)                     |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- | ---------------------------------------- |
| BGP-4                                                          | RFC 4271                                                                                                                 | `routing.bgp`                                                     | ROS, JUN, FOS                            |
| Multiprotocol BGP, IPv6 routes                                 | RFC 4760, RFC 2545                                                                                                       | neighbor `address_families`                                       | ROS, JUN, FOS                            |
| 4-byte AS numbers                                              | RFC 6793                                                                                                                 | `network.asn`, `remote_as`                                        | ROS, JUN, FOS                            |
| BGP roles, route leak prevention                               | RFC 9234                                                                                                                 | neighbor `role`                                                   | ROS (JUN and FOS refuse it)              |
| BGP filters: prefix lengths, max prefixes, community scrubbing | BCP 194 (RFC 7454)                                                                                                       | `presets.bgp_sanity`, `max_prefixes`, `{ communities: "import" }` | ROS, JUN, FOS                            |
| Standard communities                                           | RFC 1997                                                                                                                 | policy `standard_community`, `*_standard_communities`             | ROS, JUN, FOS                            |
| Large communities                                              | RFC 8092                                                                                                                 | policy `large_community`, `*_large_communities`                   | ROS, JUN                                 |
| Community scheme: tags and requests                            | Practice: RFC 8195 (Informational)                                                                                       | `circuit({ communities })`, `{ communities }` rules               | ROS, JUN                                 |
| Community catalogue for looking glasses                        | Practice: NLNOG Ring looking glass format                                                                                | `network.communities`                                             | Circuit itself (`circuit communities`)   |
| Blackhole on request                                           | Practice: RFC 3882 (Informational)                                                                                       | scheme `blackhole`, policy `set.blackhole`                        | ROS, JUN                                 |
| TCP MD5 on BGP sessions                                        | RFC 2385, obsoleted by RFC 5925 (TCP-AO), which the model does not offer                                                 | neighbor `password`                                               | ROS, JUN, FOS                            |
| Route origin validation                                        | RFC 6811, as updated by RFC 8481 and RFC 8893                                                                            | policy `rpki` match, `presets.bgp_sanity`                         | ROS, JUN                                 |
| RPKI to router protocol                                        | RFC 8210                                                                                                                 | `routing.rpki`                                                    | ROS, JUN                                 |
| BFD, single hop, for BGP, OSPF and static routes               | RFC 5880, RFC 5881, RFC 5882                                                                                             | `bfd` on neighbors, OSPF interfaces, static routes; `routing.bfd` | ROS, JUN, VRP, FOS, RCM                  |
| BFD multihop                                                   | RFC 5883                                                                                                                 | `bfd` with `multihop`                                             | ROS, JUN                                 |
| OSPFv2                                                         | STD 54 (RFC 2328)                                                                                                        | `routing.ospf`                                                    | ROS, JUN, VRP, FOS, RCM                  |
| OSPFv3                                                         | RFC 5340                                                                                                                 | `routing.ospf.address_families` with `ipv6`                       | ROS, JUN, FOS                            |
| VRRP                                                           | RFC 9568 (VRRPv3, obsoletes RFC 5798). IPv4 groups run the platform's default version, VRRPv2 on Junos, VRP and FortiOS. | interface `vrrp`                                                  | IPv4: ROS, JUN, VRP, FOS, RCM. IPv6: ROS |
| Routing security: filtering                                    | Practice: MANRS action 1                                                                                                 | `presets.bgp_sanity`, `routing.prefix_sets`                       | ROS, JUN, FOS                            |

Removed: "BLACKHOLE community, RFC 7999". The model never writes the well-known `65535:666`: its blackhole request is the network's own large community `asn:code:0`, so the row is now "Blackhole on request".

## Addresses

| Feature                           | Standard                     | In model                                                  | Rendered (platforms)                              |
| --------------------------------- | ---------------------------- | --------------------------------------------------------- | ------------------------------------------------- |
| Special-purpose (bogon) addresses | BCP 153 (RFC 6890, RFC 8190) | `presets.bogons`                                          | As data in prefix and address sets: ROS, JUN, FOS |
| Private IPv4                      | BCP 5 (RFC 1918)             | `presets.rfc1918`                                         | As data: ROS, JUN, FOS                            |
| Shared address space (CGNAT)      | BCP 153 (RFC 6598)           | `presets.bogons.ipv4.shared_address_space`                | As data: ROS, JUN, FOS                            |
| IPv4 prefixes (CIDR)              | BCP 122 (RFC 4632)           | every prefix; `address` helpers; `presets.default_routes` | ROS, JUN, VRP, FOS, RCM                           |
| IPv6 addressing                   | RFC 4291                     | every IPv6 address; `address` helpers                     | ROS, JUN, VRP, FOS, RCM                           |
| How IPv6 is written               | RFC 5952                     | `address.host`, `.first`, `.last`                         | Circuit itself (checks)                           |
| IPv6 router advertisements        | RFC 4861                     | interface `ipv6_ra`                                       | ROS, JUN, FOS                                     |

Removed: none.

## Switching

| Feature                      | Standard                                                                                                                                              | In model                                                       | Rendered (platforms)           |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------ |
| VLANs: access, trunk, native | IEEE 802.1Q-2022                                                                                                                                      | `switching.vlans`, `access_vlan`, `trunk_vlans`, `native_vlan` | ROS, JUN, VRP, FOS, RCM        |
| Link aggregation, LACP       | IEEE 802.1AX-2020 (LACP began as IEEE 802.3ad in 2000)                                                                                                | `interfaces.lag`, `mode`                                       | ROS, JUN, VRP, FOS, RCM        |
| STP, RSTP, MSTP              | IEEE 802.1Q-2022, which now holds 802.1D, 802.1w and 802.1s (802.1D is withdrawn). The model picks MSTP as a mode only, with no regions or instances. | `switching.stp`, port `stp`                                    | ROS, JUN, VRP; RCM (MSTP only) |
| LLDP                         | IEEE 802.1AB-2016                                                                                                                                     | `switching.lldp`, port `lldp`                                  | ROS, JUN, VRP, FOS, RCM        |
| Ethertypes (IPv4, IPv6, ARP) | IEEE EtherType registry                                                                                                                               | port `ethertypes`                                              | ROS, JUN, VRP, RCM             |

Removed: none.

## Tunnels and services

| Feature                       | Standard                                        | In model                            | Rendered (platforms)                                        |
| ----------------------------- | ----------------------------------------------- | ----------------------------------- | ----------------------------------------------------------- |
| GRE                           | RFC 2784                                        | `interfaces.gre`                    | ROS, JUN, FOS                                               |
| VXLAN                         | Practice: RFC 7348 (Informational)              | `interfaces.vxlan`                  | ROS, FOS                                                    |
| WireGuard                     | Not a standard: the WireGuard paper (NDSS 2017) | `interfaces.wireguard`              | ROS                                                         |
| DHCP server                   | RFC 2131                                        | `services.dhcp_server`              | ROS, JUN, FOS                                               |
| DHCP relay                    | RFC 1542, RFC 2131                              | `services.dhcp_relay`               | ROS, JUN, VRP, FOS                                          |
| NTP client and server         | RFC 5905                                        | `system.ntp`, `services.ntp_server` | Client: ROS, JUN, VRP, FOS, RCM. Server: ROS, JUN, VRP, FOS |
| DNS resolvers used and served | STD 13 (RFC 1034, RFC 1035)                     | `system.dns`, `services.dns_server` | Used: ROS, JUN, FOS. Served: ROS, FOS                       |

Removed: RFC 3046 from the DHCP relay row. It is the relay agent option (option 82), which neither the model nor any renderer writes. RFC 1542 is the relay standard.

## Firewall

| Feature                   | Standard                                                                                                                             | In model                                   | Rendered (platforms)       |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------ | -------------------------- |
| Bad TCP flag combinations | STD 7 (RFC 9293) defines the flags. Which ones to drop is practice.                                                                  | `tcp_flags` match, `presets.bad_tcp_flags` | ROS (FOS refuses it)       |
| Service ports             | IANA port registry, BCP 165 (RFC 6335)                                                                                               | `presets.ports`                            | As data in rules: ROS, FOS |
| Amplification ports       | Practice: CISA alert TA14-017A (archived, last revised 2019). Six preset ports are not in it: SLP, MS-SQL, ARD, CoAP, Ubiquiti, DVR. | `presets.udp_amplifiers`                   | As data in rules: ROS, FOS |
| SYN cookies               | Practice: RFC 4987 (Informational)                                                                                                   | `system.ip_stack.syn_cookies`              | ROS (FOS refuses it)       |
| ICMP redirects on or off  | STD 5 (RFC 792); RFC 4861 for IPv6                                                                                                   | `system.ip_stack.icmp_redirects`           | ROS, JUN, FOS              |

Removed: none.

## Monitoring and management

| Feature                            | Standard                                                                                    | In model                                       | Rendered (platforms)                                       |
| ---------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------- |
| SNMPv3 with USM (SHA-1, DES)       | STD 62 (RFC 3411 to RFC 3418)                                                               | `monitoring.snmp.users`                        | ROS, JUN, VRP, FOS, RCM                                    |
| SNMPv3 AES-128 privacy             | RFC 3826                                                                                    | `privacy: "aes128"`                            | ROS, JUN, VRP, FOS, RCM                                    |
| SNMPv3 SHA-256 authentication      | RFC 7860                                                                                    | `auth: "sha256"`                               | JUN, VRP (ROS writes SHA-1 instead; FOS and RCM refuse it) |
| SNMPv2c read community             | RFC 1901 (Historic)                                                                         | `monitoring.snmp.community`                    | ROS, JUN, VRP, FOS, RCM                                    |
| Syslog severities and UDP port 514 | RFC 5424 (the eight severities), RFC 5426 (UDP). The message format is each platform's own. | `monitoring.syslog`, `system.logging`          | ROS, JUN, VRP, FOS, RCM                                    |
| sFlow                              | Not a standard: sFlow version 5 (sflow.org)                                                 | `flow_export` `sflow`                          | JUN, VRP, FOS                                              |
| NetFlow v9                         | Practice: RFC 3954 (Informational)                                                          | `flow_export` `netflow-v9`                     | ROS, FOS                                                   |
| IPFIX                              | STD 77 (RFC 7011)                                                                           | `flow_export` `ipfix`                          | ROS                                                        |
| SSH, user keys                     | RFC 4251 to RFC 4254 (keys: RFC 4252)                                                       | `management.ssh`, user `ssh_keys`              | SSH: ROS, JUN, VRP, FOS, RCM. Keys: ROS, JUN, FOS          |
| Certificates in PEM                | RFC 5280 (X.509), RFC 7468 (PEM)                                                            | `system.certificates`                          | ROS, FOS                                                   |
| Alarm severities                   | ITU-T X.733                                                                                 | `system.alarms`                                | VRP                                                        |
| Time zones                         | IANA tz database (BCP 175, RFC 6557)                                                        | `system.timezone`                              | ROS, JUN, FOS; VRP and RCM as a UTC offset                 |
| Peering records                    | Not a standard: PeeringDB API                                                               | `integrations.peeringdb`, interface `exchange` | Circuit itself (`circuit peeringdb`)                       |

Removed: none.
