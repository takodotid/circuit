# VRP traps

Behaviour that looks like something else. Each one has been hit on a CE6855 running V200R005.

- Changes stage in a candidate and apply at `commit`. `commit` does not write to flash; without `save` a reboot restores the old configuration. `save` asks `[Y/N]`.
- An ACL bound to a service with no rules denies everything, including the session doing it. Rules and binding go in one commit.
- The first login asks to change the password. Answering Y replaces it at once and invalidates every stored credential; always answer N.
- SSH negotiates an ECDSA host key it then signs wrongly, so the handshake fails. Pin `ssh-rsa`.
- Connections in quick succession are refused before authentication for a while. Connect one at a time.
- Accounts lock after a few failures and the last ten passwords are refused. A retry loop locks the account out.
- A `?` sent by a script is executed, not treated as help. Never send one.
- `reset saved-configuration` erases the management address. Never over the network.
- The prompt shows commit state: `[~host]` clean, `[*host]` uncommitted. Read `display configuration candidate` when in doubt.
- LLDP is off by default. A port setting for LLDP is refused until it is on globally.
- A trunk forwards its native VLAN's untagged frames only when that VLAN is also allowed; the adapter adds it.
- The name `admin` is refused for a local user.
- A port joins an Eth-Trunk only while it has no other setting, including a description.
- An empty block such as `bfd` enters its view; the next line sent goes into it unless the view is left.
- SNMPv3 passwords are asked for interactively, twice. `authentication-mode` must come before `privacy-mode`.
- `abort` is not a command here. `clear configuration candidate` discards uncommitted changes.
- sFlow samples per port, `sflow sampling rate N`, N from 4096; the default is 8192 and an explicit 8192 is kept as written. A port can point to a collector only once the collector exists globally; until then it is refused with "collector does not exist".
- `vlan batch` has every VLAN on one line, and undoing a list that includes a VLAN with an L3 interface is refused. A change sends only the VLANs added and `undo vlan batch` for the ones removed.
- A VLAN name is unique across VLANs: a new VLAN cannot take a name another still has. VLANs no longer used, and their VLAN interfaces, are removed first, in the same candidate.
- `undo ssh server key-exchange <algorithms>` is refused with "Too many parameters"; `undo ssh server key-exchange` takes none. `hmac` was proved the same way. `cipher` is undone the same way but was not proved on its own.
- A console on a password only (`passwordOnly`) shows `Please Press ENTER.` after a logout or a refused password, and `Error: The password is invalid.` for a wrong one.
- Once SNMP is on, the switch prints an engine ID of its own, `snmp-agent local-engineid`, derived from its MAC, and prints each SNMPv3 user as a bare `snmp-agent usm-user v3 <name>` line before its settings. Planning against either as unrendered would undo the user; seen on a CE6855 on V200R005C00SPC800.
- `apply --secrets` sends every line holding a secret again, the local users' passwords included, and a password among the user's last ten is refused, which discards the whole candidate. Send it only when a password changed.
- An SNMPv3 key prints as `cipher %^%#...%^%#`, which can be turned back into the key. The read redacts every value after `cipher`, as it does a password.
- `display configuration candidate` shows the uncommitted lines as they were sent, not as the switch will print them. Commit to see the printed form.
- An ACL bound to a service cannot be removed: `undo acl number N` is refused at once with "This ACL is being used.", even when the same candidate already moved the binding. ACLs no longer used are removed last.
- An ACL rule sent over a rule of the same number merges into it: `rule 10 deny` over `rule 10 permit source A` leaves `rule 10 deny source A`. A changed rule is undone first.
- A single source address prints its wildcard as `0`: `rule 5 permit source 192.0.2.1 0`.
- `snmp-agent group v3 <group> ... acl N` sent again with another ACL replaces the binding in place.
- A log host line sent again changes only the options it names: `info-center loghost A port 514` over `level informational` keeps the level. A log host that loses an option is undone first. Its undo takes the address alone, `undo info-center loghost A`; `level ...` after it is refused with "Too many parameters".
- Defaults are not printed: a log host's `level debugging` and `port 514`, the log files' level `debugging` (channel 9) and `info-center max-logfile-number 200`. The file count is 3 to 500. Every log host line warns "non secure syslog protocol" and is still taken.
- `undo info-center source default channel 9` turns the log files' default source off and prints as that line; `info-center source default channel 9` puts it back. Circuit undoes the level alone: `undo info-center source default channel 9 log level`.
