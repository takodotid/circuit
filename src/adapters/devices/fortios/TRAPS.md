# FortiOS traps

Behaviour that looks like something else. Each one has been hit on a FortiGate 3700D running FortiOS 6.2.2, without a licence.

- A change applies at `next` or `end`, and with `cfg-save automatic`, the factory setting, it is saved at once. `abort` discards the changes of the one object being edited, and only there: inside a table it is `Unknown action 0`, and the entries already left with `next` are applied.
- `cfg-save revert` keeps changes running but unsaved, and `cfg-revert-timeout` seconds after a change the device announces `System will reload` and reloads its saved configuration. The reload restarts the configuration, not the hardware, and takes about two minutes. `execute cfg reload` does the same at once, without asking, and says `no config to be reloaded` when nothing is unsaved. `execute cfg save` saves; setting `cfg-save automatic` again saves too.
- `cfg-save revert` set while saving is automatic is saved itself. After a reload the device is still in revert mode, and from then on every change made by hand is undone after the timeout until someone saves it or sets `cfg-save automatic`. Circuit sets it back at the end of every apply.
- `execute config-transaction start N` opens a candidate that `commit` applies and `abort` discards, but Circuit does not use it on 6.2.2. Inside one, deleting an entry does not release what its lists name, so deleting a policy and then the address it named is refused: `The entry is used by other 1 entries`. A transaction whose session is cut off keeps every object it touched locked until its N minutes run out: `Can not config the object since it's being configured by another transaction`. Editing a `firewall policy6` entry after `unset central-nat` ends the session at `edit`. Deleting the user you are logged in as ends the session with `cmdb_txn_cache_data ... failed` and breaks every later transaction until the device restarts. `show` prints a new static route or policy with the comment of the last new one, which the commit corrects. OSPF's `config redistribute` is refused, `config child object 'redistribute' is not handled in transaction`, and a certificate added in one cannot be named until the commit. None of these happen outside a transaction.
- The CLI pages long output with `--More--`, and erases the prompt with spaces and a carriage return once it is answered.
- A `?` typed anywhere shows help at once and is never sent. Ctrl-V before it types it literally.
- The idle timeout, `admintimeout`, is 5 minutes by default; the session then returns to `login:`.
- With `pre-login-banner` on, the console shows the banner and waits on `(Press 'a' to accept):` before `login:`. Circuit answers `a`.
- `grep` after a pipe takes no `-E`, and a command ending in `| grep` reports `Command fail. Return code -27` after printing its matches.
- `show` prints a setting only when it differs from its default, and prints keys in its own order, not the order they were set. A new aggregate is given `device-identification enable` and `lldp-transmission enable`, a new VLAN interface `device-identification enable` and `role lan`, without being asked. Circuit unsets them.
- A port joins an aggregate only while nothing names it, such as a static route, `entry not found in datasource`, and its speed cannot change while it is in one, not even back to `auto`: `Interface speed cannot be set for aggregated interfaces`. Circuit frees ports first: what names a port that joins is deleted and created again after, a port whose speed changes leaves its aggregate and joins again, and an aggregate that goes, or is left with no port, goes before anything else with what names it.
- `unset secondary-IP` hides the list of secondary addresses and drops it. NTP's `unset type` hides its servers but keeps them: `set type custom` brings them back. NTP refuses to delete its last server while `ntpsync` is on, and to empty the interfaces it serves on while `server-mode` is on, `There aren't any interfaces with NTP server enabled`; `unset server-mode` hides that list and lets go of the interfaces in it. The plan deletes a nested list before the setting that hides it, except `ntpsync`, which goes first.
- A DHCP server prints `dns-server1` only while `dns-service` is `specify`, the default, which `show` does not print. The factory server on `mgmt1` uses `default`, so the render states `specify` before its resolvers.
- The timezone is a number of the platform's own, such as `53` for Jakarta, Bangkok and Hanoi. The default is `00`, Eniwetok, at UTC+12; UTC is `80`.
- Global `alias` is set again at every start, whatever was saved.
- `log memory setting` prints its `status` whether on or off, and `unset status` turns memory logging on.
- Two interfaces that are up cannot hold overlapping subnets, `Subnets overlap between ...`, so an address moving from one to another must leave the first before it joins the second.
- A static route identical to another is refused, `Duplicated entry`. An IPv4 route's destination is not printed when it is the default route; neither is IPv6's.
- A deny policy is given `logtraffic disable`, and its action is not printed, since deny is the default. `send-deny-packet` exists only while a policy denies: set before `action deny` or unset after `action accept`, it is `command parse error`. The render states `action deny`, and the plan undoes what goes before it sets what comes.
- `show` prints `unset` in two places: an ICMP service's `unset icmptype`, and a prefix list rule's `unset ge` and `unset le` for a bound it does not hold.
- An SNMPv3 user authenticates with MD5 or SHA1 only, and has no list of sources: only a community has hosts. Circuit decides who reaches every service with local-in policies instead.
- The console ignores a user's trusted hosts.
- A tunnel's interface takes an IPv4 address only as a host, with the far end in `remote-ip`: `set ip 10.0.0.1 255.255.255.252` on one is dropped without a word.
- A GRE or VXLAN tunnel creates an interface of its own, named after it, which goes when the tunnel goes. VXLAN has no local address: it leaves from the address of the interface it names.
- A static route has no VRF of its own. It lands in the VRF of the interface it leaves through, as `get router info routing-table all` shows, so a blackhole route cannot go in a VRF. OSPF and BGP have no VRF setting.
- The stateless ACL, `firewall acl` and `acl6`, only drops: it has no action.
- A route map stops at the first rule that matches, with no way to go on to the next, and its rules permit unless told to deny.
- `show vpn certificate local` prints a certificate without its text or key. `show full-configuration` prints both, the key encrypted.
- A private key the device cannot read is answered `Invalid private key, password may be required`, with no `Command fail`, and the session goes on, as it is for one whose lines end in CR LF: the CLI takes each CR as a line of its own; the certificate fails only at `end`, `Attribute 'private-key' MUST be set`.
- A GRE or VXLAN interface takes no flow sampler, and says so without `Command fail`: `Netflow sampler isn't supported on Tunnel interface..`, and the same for sFlow and for VXLAN.
- A port in an aggregate has no `icmp-send-redirect`, `command parse error`, and loses it when it joins one.
- `purge` empties a table after asking `(y/n)`.
- A loopback has no MTU of its own and runs no VRRP. An interface's name has at most 15 characters.
- There is no WireGuard and no RPKI, `command parse error`. A route map has no large community and a BGP neighbor no role: neither is among their settings. SNMPv3 offers no SHA256.
- `execute backup config flash <comment>` keeps a revision on the device, and `execute restore config flash <id>` restores one.
- The ports are `port1` to `port4` at 40G and `port5` to `port32` at 10G, then `mgmt1` and `mgmt2`. The factory dedicates both management ports to management and gives them addresses `192.168.1.99` and `192.168.2.99`.
