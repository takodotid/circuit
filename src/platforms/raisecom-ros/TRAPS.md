# Raisecom ROS traps

Behaviour that looks like something else. Each one has been hit on a RAX721 running ROS 6.5.2.

- Commands apply as they arrive and persist only on `write`.
- The SSH server offers only an `ssh-rsa` host key. The adapter allows it for this platform alone; key exchange, cipher and MAC still negotiate modern ones.
- `show running-config` stops about halfway with no error unless `terminal page-break disable` is sent first and the read waits several seconds of silence.
- A `?` sent by a script is executed. Once it applied an address with a /8 mask.
- An access-list cannot change while any service uses it: `ACL 1000 is in use`. Every service that uses it is unbound first and bound again after. `no ssh2 access-list` needs the list number.
- `portswitch`, `switchport trunk allowed vlan` and `switchport mode` ask for `y` and do nothing without it, except when they need no confirming: `switchport mode trunk` on a port leaving access mode answers `Set successfully` at once, and a `y` sent after it is refused, `Error input`.
- A VLAN is removed with `no vlan <id>`, not `no create vlan`.
- `no storm-control mode` is refused with `Error input`. The modes are `kbps`, the default, which prints nothing, and `pps`; leaving `pps` is setting `kbps`.
- A port's speed or duplex set to something else and back to auto prints `speed auto` and `duplex auto` from then on, though auto is the default. `no duplex auto` is refused with `Error input`.
- Tab after a word the CLI does not know answers `Error input`, as if the line were sent. Like `?`, it is not a safe way to explore.
- The factory account `raisecom` cannot be removed and its service type cannot change. Only its password is ours.
- Factory SNMP communities survive hardening, and `private` can write. The render removes both.
- Several commands are not the usual spelling: `terminal page-break disable`, `telnet-server disable`, `ip rarp server disable`.
- An access-list description takes one word. A space is refused with `Error input`.
- The out-of-band port `fastethernet 1/0/1` cannot be shut down and is not in the catalog.
- A LAG is `interface port-channel N`. LACP is its default and prints nothing; a static LAG prints `mode manual`. The LAG takes layer 2 settings only after `portswitch`, and a port joins with `portswitch` then `port-channel N`.
- An SNMPv3 user prints as localized keys, `authkey sha <hex> privkey  aes128 <hex>`, which authenticate as well as the passphrase. The read redacts them. An access group prints a `notify internet` it was not given. A user's group is removed with `no snmp-server group user <user> usm`.
- A VRRP group is enabled once it has an address and preempts unless `no vrrp N preempt`. `no vrrp N ip <address>` removes the whole group.
- OSPF settings for an interface sit on the interface, `ip ospf cost`, `ip ospf network ptp`, `ip ospf passive-interface enable`; passive is undone with `... disable`, not `no`.
- `create vlan <list> active` has every VLAN on one line. A change creates only the new VLANs and removes each one that is gone with `no vlan <id>`.
- An access-list rule is not replaced by one with the same number: the device answers `Set unsuccessfully.` and keeps the old rule. The old one is removed first. `no rule N` answers slowly, after a second or more.
- `show running-config` can stop partway even with paging off and six seconds of silence, with no error: on 2026-10-23 three reads of an RAX721 in a row gave plans of 62, 0 and 158 commands against an unchanged switch. A dump that does not end at the prompt is read again, and after three the read fails rather than planning against a part.
- On a lossy path a TCP retransmit can stall `show running-config` for several seconds mid-dump, and a read that stopped at the first long silence gave up after three tries (seen with 5 to 25% loss, #86). The read now waits for the dump to end at the prompt, up to 30 seconds of silence and 150 seconds in all.
- `show lldp remote` shortens port names (`TGE1/3/3`, `100GE1/1/4`) and pads its columns, so a system name with a space cannot be told apart. The read uses `show lldp remote detail`, which spells each port in full; a long value there wraps mid-word onto a line that starts with spaces.
- The switch sends its own LLDP system name as `Raisecom`: the render sets no hostname, so a neighbor sees `Raisecom`, not the device's name.
- A Junos neighbor sends its port as a number (`PortIdSubtype: local`, `PortId: 520`), its SNMP index, and its description as `PortDesc`. The read keeps the number; matching it to a `link` needs the Junos side to send the port's name.
- `snmp-server access-list 1001` adds a list beside `1000` rather than replacing it, and SNMP then holds both. The plan binds the new list first and then sends `no snmp-server access-list 1000`, so SNMP is never left without one. SNMP's own sources are access-list 1001.
- `logging host <ip>` takes a level by name (`warnings`) or number and a port as `udpport <n>`, level first: `logging host <ip> udpport <n> warnings` is refused with `Error input`, `port` and `udp-port` too. It prints the level as a number and leaves out level 6 and port 514: `logging host 192.0.2.50 4 udpport 5140`. A second `logging host` for the same address changes it in place; `no logging host <ip>` removes it whatever its level and port.
- Port security takes only a switched port: `switchport port-security` on a port without `portswitch` is refused with `Error input`. It takes a maximum of 1 to 1024; 1024 is its default and prints nothing. Its action at the limit is `protect`, drop, and learned addresses age out after 5 minutes. `no switchport port-security maximum` takes no number.
- A MAC access-list is `access-list 3000` and up. A rule's ethertype is hex without `0x` (`0x86DD` is refused with `The EtherType is INVALID!`, and `2054` is 0x2054, not ARP); `0800` and `0806` print as `ip` and `arp`, any other as `86dd ffff`. A port binds it with `filter ingress access-list N`, which answers nothing, also on a port without `portswitch`.
- A MAC access-list a port filters with cannot change: `ACL 3000 is in use, and it can not be modified or destroyed`. Each port has its own list, 3001 and up by its place in the catalog, and the plan unbinds the port, changes the list and binds it again.
- `no portswitch` asks for `y` like `portswitch`; a port the plan switched stays switched when it goes back to unused, which the read cannot see.
