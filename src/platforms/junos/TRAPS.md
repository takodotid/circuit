# Junos traps

Behaviour that looks like something else. Each one has been hit on a QFX5100-48S-6Q running Junos 21.4R3.

- Changes stage in a candidate and apply at `commit`. `commit confirmed N` applies them and rolls them back after N minutes unless another `commit` confirms them. `commit` also saves: there is no separate save.
- The device counts ports from 0, and the 40G ports follow the 10G ones: `10g-1` is `xe-0/0/0`, `10g-48` is `xe-0/0/47`, `40g-1` is `et-0/0/48`. The two management ports, `em0` and `em1`, are `1g-1` and `1g-2`.
- `load set terminal` reports a refused statement as `terminal:12:(8) syntax error: ...`, then says `load complete` and keeps every statement it accepted. Circuit discards the whole candidate on any refusal.
- A value is cut at `(`, `&` or `|` unless it is quoted: `description a|b` is stored as `a`, with an error. The render quotes every value that is not a plain word.
- The device decides for itself which values it prints in quotes: `noc@example.com` comes back quoted, `"Router"` comes back plain. The plan compares values without their quotes.
- The device prints only the longest form of a statement. `set protocols rstp interface xe-0/0/0` disappears once `... xe-0/0/0 edge` is set, so the render leaves it out too.
- A delete cannot stop at a list whose entries are named: `delete interfaces xe-0/0/1 unit` is refused with `syntax error, expecting <identifier>`, while `unit 0` works. `show` refuses the same way. A list of plain values, such as `vlan members` or `ciphers`, can go whole.
- `delete` with a value removes the statement only when the value matches; otherwise it says `warning: statement not found` and changes nothing.
- A `?` shows help and is not executed, but the Enter after it sends the line typed so far, which may be a complete command.
- `operator`, `daemon`, `bind`, `kmem`, `nobody`, `sshd`, `tty` and `uucp` are system accounts. A user with one of those names fails the commit check: `user name is used by a system account`.
- Root logs in to a shell, `root@:RE:0%`, and reaches the CLI with `cli`. Every other user lands in the CLI.
- A password set with `plain-text-password-value` prints as a `$6$` hash. SNMPv3 passwords print as `$9$` keys, which can be turned back into the password. The read redacts both.
- An SNMP community prints in clear, and its value is also its name, so a new value is a second community. A new value is sent after the old communities are deleted, each by its name, which Circuit looks up during the apply and never prints.
- A firewall filter name is unique across families. The filter guarding the device's services is `circuit-services` for IPv4 and `circuit-services-v6` for IPv6.
- A VLAN interface's MTU above what its ports carry commits with only a warning, `mtu 9000 is bigger than member link`.
- There is no `protocols stp`. Plain STP is RSTP limited with `force-version stp`.
- sFlow interfaces print with their unit, `xe-0/0/0.0`.
- The factory VLAN `default` can be deleted.
- BGP without a licence commits with only a warning, `requires 'bgp' license`, and sessions establish. The same is true for the other licensed features.
- Junos accepts and announces every route over eBGP unless a policy says otherwise: `Default eBGP mode: advertise - accept, receive - accept`. A session without a policy is given `circuit-reject-all`.
- An export policy sees every active route, not only BGP's. Every export starts with `circuit-bgp-origin`, which passes on BGP's routes and the prefixes in `routing.bgp.networks` and rejects the rest.
- A policy's or a filter's terms are kept in order, and `set` adds a new term at the end. A change to one rewrites it whole.
- One policy term cannot filter IPv4 and IPv6 prefixes together: `invalid prefix ::/0 for family inet`. A rule for both families becomes a term for each.
- A port filter cannot match the VLAN a frame is switched in: `learn-vlan-id not supported on ingress interface`.
- IPv4 routes over an IPv6 session need a local IPv4 address under the family: `Local IPv4 address must be configured`.
- A DHCP server and a DHCP relay cannot share an interface: `Interface irb.10 already configured`.
- A port's MTU counts the Ethernet header. `mtu 9018` carries 9000-byte packets with a VLAN tag, and a VLAN interface's 9000 then commits without a warning.
- The serial console has no flow control. Statements pasted into `load set terminal` at once overrun it: some arrive garbled, the load reports syntax errors, and the `^D` that ends it can be lost, leaving the console in the load. Circuit sends each statement after the echo of the one before.
- After a login the console prints `Last login: ...`, which ends in `login: ` like the login prompt; only a `login: ` on a line of its own is the prompt.
- A factory-default switch runs Auto Image Upgrade, which prints on the console every few seconds until `delete chassis auto-image-upgrade` is committed.
