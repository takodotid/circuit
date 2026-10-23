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
