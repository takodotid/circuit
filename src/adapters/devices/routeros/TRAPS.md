# RouterOS 7 traps

Behaviour that looks like something else. Each one has been hit on a real device.

- Every command takes effect as it arrives; there is no candidate configuration. `apply` saves a backup, arms a scheduler that restores it, and restores at once if a command is refused.
- A `/32` address gives no connected route, so a session over it never opens. State the far end: `{ address, peer }` renders `network=<peer>`.
- `[find address=X/Y]` unquoted matches nothing, silently. Every selector the plan builds is quoted.
- `~` in `find` has no anchors. Match exactly.
- A property of the same group is printed as a bare suffix, `output.filter-chain=X .network=Y`, which only reads back inside that command. The parser expands it before building a `set`.
- `/routing bgp connection add` without `local.role` is refused, so the render always states one.
- A connection without `input.filter` accepts everything. A neighbor without a policy is given `REJECT-ALL`.
- A session edited repeatedly can stick: SYN both ways, no RST, no log. Remove the connection and add it again.
- A session that never established is missing from `/routing bgp session print`; look at `/routing bgp connection print`.
- `tcp-md5-key` set from the CLI has been seen discarded without an error, and a mismatch logs nothing. Confirm with `/tool sniffer quick port=179`.
- Incoming GRE is subject to the input chain. Accept it before testing the tunnel.
- Switch-chip rules have no address lists and no connection state. A drop is an empty `new-dst-ports`.
- A switch-chip rule's `rate` did not limit traffic the CPU routes. On a CCR2216 on 7.23.5, under a 12 Gbps flood, a rule at `2G` and then at `100M` changed nothing that reached the CPU, while a drop with the same match left 3 Mbps. Drop what you can recognise instead of limiting it.
- The switch chip reads a UDP fragment after the first as port 0. `src-port=0` drops the rest of a fragmented flood whose first fragments another rule dropped by port; without it they reach the CPU, which holds them waiting for a first fragment that never comes.
- A switch-chip rule takes one port or a range, `1900-1901`; a list is refused. The render makes one rule for each port in a list.
- Any rule using fasttrack adds a dynamic "special dummy rule to show fasttrack counters" to the filter and the raw table. It cannot be removed, `cannot remove builtin`, so every selector over those menus skips dynamic entries.
- The connection table holds 1,048,576 entries on a CCR2216 with 16 GiB, and a full table refuses every new connection through the router, not only the target's. A SYN flood of 210,000 packets a second filled it in five seconds; a UDP flood from random sources fills it about six times faster, because an unanswered UDP entry lives 30 seconds. Traffic in `untracked` prefixes never enters it.
- With hardware offload on, routed traffic bypasses the forward chain entirely. `hardware_offload: false` on an interface is what makes the firewall apply to it, at the cost of CPU. The only proof of offload is the `H` flag on a route.
- `/ip cloud ddns-enabled` cannot be turned off on 7.23.5.
- `mac-server` and `mac-winbox` work at layer 2 and ignore the IP firewall; they are limited by interface list.
- `time-zone-autodetect` is on by default and wins after a restart. The render turns it off.
- The SSH client drops a password sent together with its newline. Send the password, wait, then the newline.
- A serial console login redraws lines unless the user name carries `+cwt`.
- Narrowing a subnet is a change in several places: the address, the DHCP network, and every switch on the LAN. A mismatch breaks only the return path, so a test from the router passes.
- In `find`, a quoted `"yes"` is a string and matches no boolean, silently. Plain words go bare; only values with a slash or a space are quoted.
- `:put [:parse "..."]` compiles a command without running it and names a syntax error or an unknown property. `apply` checks every command this way before the backup is taken.
- A refused command restores the backup, which restarts the router. Expect every session to re-establish over a minute or two.
- `strong-crypto=yes` also hardens the device's own SSH client, which then fails silently toward devices that only speak older algorithms.
- SNMPv3 authenticates with MD5 or SHA1 only on 7.23.
- In a quoted string `$` starts a variable. The adapter escapes it.
- A script sent over SSH exec runs as one line; a multi-line script fails with `expected closing brace`.
- `:find` on an array returns a number or `nil`. Globals persist between exec commands of one login.
- A fixed port speed is named by medium, `speed=10G-baseSR-LR` for an optic or `speed=1G-baseT-full` for copper, and only holds with `auto-negotiation=no`. With auto-negotiation back on, the export no longer prints the speed, so the plan resets only auto-negotiation. `speed=""` is refused as ambiguous and `unset speed` does not exist.
- `bgp-path-len` counts every AS in the path, prepends included, and takes the same strict comparisons as `dst-len`.
- `:parse` checks the command, not the text inside `rule=`. A routing filter rule is only checked when it is added.
- `/routing/filter/filter-wizard` adds the rule it builds; it is not a dry run. `set blackhole yes` was proved this way on 7.23, in an unused chain removed right after.
