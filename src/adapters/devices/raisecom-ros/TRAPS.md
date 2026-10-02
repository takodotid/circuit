# Raisecom ROS traps

Behaviour that looks like something else. Each one has been hit on a RAX721 running ROS 6.5.2.

- Commands apply as they arrive and persist only on `write`.
- The SSH server offers only an `ssh-rsa` host key. The adapter allows it for this platform alone; key exchange, cipher and MAC still negotiate modern ones.
- `show running-config` stops about halfway with no error unless `terminal page-break disable` is sent first and the read waits several seconds of silence.
- A `?` sent by a script is executed. Once it applied an address with a /8 mask.
- An access-list cannot change while any service holds it: `ACL 1000 is in use`. Every holder is released first and bound again after. `no ssh2 access-list` needs the list number.
- `portswitch`, `switchport trunk allowed vlan` and `switchport mode` ask for `y` and do nothing without it.
- A VLAN is removed with `no vlan <id>`, not `no create vlan`.
- The factory account `raisecom` cannot be removed and its service type cannot change. Only its password is ours.
- Factory SNMP communities survive hardening, and `private` can write. The render removes both.
- Several commands are not the usual spelling: `terminal page-break disable`, `telnet-server disable`, `ip rarp server disable`.
- An access-list description takes one word. A space is refused with `Error input`.
- The out-of-band port `fastethernet 1/0/1` cannot be shut down and is not in the catalog.
- A LAG is `interface port-channel N`. LACP is its default and prints nothing; a static LAG prints `mode manual`. The LAG takes layer 2 settings only after `portswitch`, and a port joins with `portswitch` then `port-channel N`.
- An SNMPv3 user prints as localized keys, `authkey sha <hex> privkey  aes128 <hex>`, which authenticate as well as the passphrase. The read redacts them. An access group prints a `notify internet` it was not given. A user's group is removed with `no snmp-server group user <user> usm`.
- A VRRP group is enabled once it has an address and preempts unless `no vrrp N preempt`. `no vrrp N ip <address>` removes the whole group.
- OSPF settings for an interface sit on the interface, `ip ospf cost`, `ip ospf network ptp`, `ip ospf passive-interface enable`; passive is undone with `... disable`, not `no`.
