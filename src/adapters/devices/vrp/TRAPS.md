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
- A port joins an Eth-Trunk only while it holds no other setting, including a description.
- An empty block such as `bfd` enters its view; the next line sent goes into it unless the view is left.
- SNMPv3 passwords are asked for interactively, twice. `authentication-mode` must come before `privacy-mode`.
- `abort` is not a command here. `clear configuration candidate` discards uncommitted changes.
- sFlow samples per port, `sflow sampling rate N`, N from 4096; the default is 8192 and an explicit 8192 is kept as written. A port names a collector only once the collector exists globally; until then it is refused with "collector does not exist".
