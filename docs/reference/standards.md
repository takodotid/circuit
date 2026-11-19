---
description: The RFC, IANA list, or published practice behind each feature Circuit writes or checks.
---

# Standards

The [feature matrix](/reference/platforms#feature-matrix) shows which platforms have each feature.

- **In model** is the field, preset, or check you write.
- **Practice** marks a published practice or an Informational RFC, not a standard.

Each RFC's status is as the RFC Editor listed it on 2026-11-01.

## Routing

| Feature                                                        | Standard                                                                                                                  | In model                                                             |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| BGP-4                                                          | RFC 4271                                                                                                                  | `routing.bgp`                                                        |
| Route aggregation                                              | RFC 4271                                                                                                                  | `routing.bgp.aggregates`                                             |
| Default route to one neighbor                                  | Practice: OpenConfig BGP model, `send-default-route`                                                                      | neighbor `send_default_route`                                        |
| Multiprotocol BGP, IPv6 routes                                 | RFC 4760, RFC 2545                                                                                                        | neighbor `address_families`                                          |
| 4-byte AS numbers                                              | RFC 6793                                                                                                                  | `network.asn`, `remote_as`                                           |
| BGP roles, route leak prevention                               | RFC 9234                                                                                                                  | neighbor `role`                                                      |
| BGP filters: prefix lengths, max prefixes, community scrubbing | BCP 194 (RFC 7454)                                                                                                        | `presets.bgp_sanity`, `max_prefixes`, `{ communities: "import" }`    |
| Standard communities                                           | RFC 1997                                                                                                                  | policy `standard_community`, `*_standard_communities`                |
| Large communities                                              | RFC 8092                                                                                                                  | policy `large_community`, `*_large_communities`                      |
| AS path matches: the first AS, the origin AS                   | RFC 4271, RFC 6811 (origin AS)                                                                                            | policy `as_path_contains`, `first_as`, `origin_as`, `as_path_length` |
| Bogon AS numbers                                               | Practice: NLNOG BGP Filter Guide, from the IANA special-purpose (RFC 7249) and reserved AS numbers                        | `presets.bogon_asns`                                                 |
| Community scheme: tags and requests                            | Practice: RFC 8195 (Informational)                                                                                        | `circuit({ communities })`, `{ communities }` rules                  |
| Community catalog for looking glasses                          | Practice: NLNOG Ring looking glass format                                                                                 | `network.communities`                                                |
| Blackhole on request                                           | Practice: RFC 3882 (Informational)                                                                                        | scheme `blackhole`, policy `set.blackhole`                           |
| TCP MD5 on BGP sessions                                        | RFC 2385, obsoleted by RFC 5925 (TCP-AO), which the model does not offer                                                  | neighbor `password`                                                  |
| TTL security (GTSM)                                            | RFC 5082                                                                                                                  | neighbor `ttl_security`                                              |
| BGP route reflection                                           | RFC 4456                                                                                                                  | neighbor `route_reflector_client`, `routing.bgp.cluster_id`          |
| BGP confederations                                             | RFC 5065                                                                                                                  | `routing.bgp.confederation`                                          |
| Graceful restart                                               | RFC 4724                                                                                                                  | neighbor `graceful_restart`                                          |
| Route origin validation                                        | RFC 6811 (updated by RFC 8481 and RFC 8893)                                                                               | policy `rpki` match, `presets.bgp_sanity`                            |
| RPKI to router protocol                                        | RFC 8210                                                                                                                  | `routing.rpki`                                                       |
| BFD, single hop, for BGP, OSPF, and static routes              | RFC 5880, RFC 5881, RFC 5882                                                                                              | `bfd` on neighbors, OSPF interfaces, static routes; `routing.bfd`    |
| BFD multihop                                                   | RFC 5883                                                                                                                  | `bfd` with `multihop`                                                |
| OSPFv2                                                         | STD 54 (RFC 2328)                                                                                                         | `routing.ospf`                                                       |
| OSPFv3                                                         | RFC 5340                                                                                                                  | `routing.ospf.address_families` with `ipv6`                          |
| OSPF stub areas                                                | STD 54 (RFC 2328)                                                                                                         | area `type: "stub"`, `no_summaries`, `stub_default_cost`             |
| OSPF NSSA                                                      | RFC 3101                                                                                                                  | area `type: "nssa"`                                                  |
| OSPFv2 authentication                                          | STD 54 (RFC 2328) for MD5, RFC 5709 for HMAC-SHA                                                                          | OSPF interface `authentication`                                      |
| VRRP                                                           | RFC 9568 (VRRPv3, obsoletes RFC 5798). IPv4 groups run the platform's default version, VRRPv2 on Junos, VRP, and FortiOS. | interface `vrrp`                                                     |
| Routing security: filtering                                    | Practice: MANRS action 1                                                                                                  | `presets.bgp_sanity`, `routing.prefix_sets`                          |

Circuit doesn't use the well-known BLACKHOLE community `65535:666` (RFC 7999). A blackhole request is the network's own large community, `asn:code:0`.

## Addresses

| Feature                           | Standard                     | In model                                                  |
| --------------------------------- | ---------------------------- | --------------------------------------------------------- |
| Special-purpose (bogon) addresses | BCP 153 (RFC 6890, RFC 8190) | `presets.bogons`                                          |
| Private IPv4                      | BCP 5 (RFC 1918)             | `presets.rfc1918`                                         |
| Shared address space (CGNAT)      | BCP 153 (RFC 6598)           | `presets.bogons.ipv4.shared_address_space`                |
| IPv4 prefixes (CIDR)              | BCP 122 (RFC 4632)           | every prefix; `address` helpers; `presets.default_routes` |
| IPv6 addressing                   | RFC 4291                     | every IPv6 address; `address` helpers                     |
| How IPv6 is written               | RFC 5952                     | `address.host`, `.first`, `.last`                         |
| IPv6 router advertisements        | RFC 4861                     | interface `ipv6_ra`                                       |

## Switching

<!-- vale Google.Units = NO -->

| Feature                      | Standard                                                                                                                                | In model                                                       |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| VLANs: access, trunk, native | IEEE 802.1Q-2022                                                                                                                        | `switching.vlans`, `access_vlan`, `trunk_vlans`, `native_vlan` |
| Link aggregation, LACP       | IEEE 802.1AX-2020                                                                                                                       | `interfaces.lag`, `mode`                                       |
| STP, RSTP, MSTP              | IEEE 802.1Q-2022, which now holds 802.1D, 802.1w, and 802.1s. The model only picks MSTP as a mode. It has no MSTP regions or instances. | `switching.stp`, port `stp`                                    |
| LLDP                         | IEEE 802.1AB-2016                                                                                                                       | `switching.lldp`, port `lldp`                                  |
| Ethertypes (IPv4, IPv6, ARP) | IEEE EtherType registry                                                                                                                 | port `ethertypes`                                              |

<!-- vale Google.Units = YES -->

## Tunnels and services

| Feature                       | Standard                                        | In model                            |
| ----------------------------- | ----------------------------------------------- | ----------------------------------- |
| GRE                           | RFC 2784                                        | `interfaces.gre`                    |
| VXLAN                         | Practice: RFC 7348 (Informational)              | `interfaces.vxlan`                  |
| WireGuard                     | Not a standard: the WireGuard paper (NDSS 2017) | `interfaces.wireguard`              |
| DHCP server                   | RFC 2131                                        | `services.dhcp_server`              |
| DHCP relay                    | RFC 1542, RFC 2131                              | `services.dhcp_relay`               |
| NTP client and server         | RFC 5905                                        | `system.ntp`, `services.ntp_server` |
| DNS resolvers used and served | STD 13 (RFC 1034, RFC 1035)                     | `system.dns`, `services.dns_server` |

## Firewall

| Feature                     | Standard                                                                                                                             | In model                                   |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------ |
| Bad TCP flag combinations   | STD 7 (RFC 9293) defines the flags. Which ones to drop is practice.                                                                  | `tcp_flags` match, `presets.bad_tcp_flags` |
| Service ports               | IANA port registry, BCP 165 (RFC 6335)                                                                                               | `presets.ports`                            |
| Amplification ports         | Practice: CISA alert TA14-017A (archived, last revised 2019). Six preset ports are not in it: SLP, MS-SQL, ARD, CoAP, Ubiquiti, DVR. | `presets.udp_amplifiers`                   |
| SYN cookies                 | Practice: RFC 4987 (Informational)                                                                                                   | `system.ip_stack.syn_cookies`              |
| ICMP redirects on or off    | STD 5 (RFC 792); RFC 4861 for IPv6                                                                                                   | `system.ip_stack.icmp_redirects`           |
| Source address check (uRPF) | BCP 84 (RFC 3704, updated by RFC 8704)                                                                                               | interface `urpf`                           |
| Source-based blackholing    | Practice: RFC 5635 (Informational)                                                                                                   | a blackhole route, with `urpf`             |

## Monitoring and management

| Feature                            | Standard                                                                                    | In model                                       |
| ---------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| SNMPv3 with USM (SHA-1, DES)       | STD 62 (RFC 3411 to RFC 3418)                                                               | `monitoring.snmp.users`                        |
| SNMPv3 AES-128 privacy             | RFC 3826                                                                                    | `privacy: "aes128"`                            |
| SNMPv3 SHA-256 authentication      | RFC 7860                                                                                    | `auth: "sha256"`                               |
| SNMPv2c read community             | RFC 1901 (Historic)                                                                         | `monitoring.snmp.community`                    |
| Syslog severities and UDP port 514 | RFC 5424 (the eight severities), RFC 5426 (UDP). The message format is each platform's own. | `monitoring.syslog`, `system.logging`          |
| sFlow                              | Not a standard: sFlow version 5 (sflow.org)                                                 | `flow_export` `sflow`                          |
| NetFlow v9                         | Practice: RFC 3954 (Informational)                                                          | `flow_export` `netflow-v9`                     |
| IPFIX                              | STD 77 (RFC 7011)                                                                           | `flow_export` `ipfix`                          |
| SSH, user keys                     | RFC 4251 to RFC 4254 (keys: RFC 4252)                                                       | `management.ssh`, user `ssh_keys`              |
| Logins through servers, accounting | TACACS+: RFC 8907 (Informational). RADIUS: RFC 2865, RFC 2866 (Informational)               | `system.aaa`                                   |
| Certificates in PEM                | RFC 5280 (X.509), RFC 7468 (PEM)                                                            | `system.certificates`                          |
| Alarm severities                   | ITU-T X.733                                                                                 | `system.alarms`                                |
| Time zones                         | IANA Time Zone Database (BCP 175, RFC 6557)                                                 | `system.timezone`                              |
| Peering records                    | Not a standard: PeeringDB API                                                               | `integrations.peeringdb`, interface `exchange` |
