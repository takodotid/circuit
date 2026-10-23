---
description: How Circuit works with Juniper Junos, and the Junos behaviour that looks like something else. Each one has been hit on a QFX5100-48S-6Q running Junos 21.4R3.
---

<!--@include: ../../src/platforms/junos/TRAPS.md-->

## How Circuit writes a Junos device

- **The root password is part of the file.** Junos refuses a configuration without one, so `users` must have a user called `root`, with the role `admin`. Connect with another user: root lands in a shell instead of the CLI.
- **Who may reach the device's services** is a firewall filter on every loopback and on each management port with an address. `management.allow`, or a service's own `allow`, decides who reaches SSH, telnet, FTP and SNMP. When the device keeps time from servers and `system.ntp.serve` is off, the device answers time queries only from those servers.
- **A 10G port with a 1G optic** is called `ge-` instead of `xe-` in Junos. Write `speed: "1g"` on the port. The name a port is not using is turned off, so swapping the optic does not bring up a port nobody configured.
- **BGP runs without a licence.** Junos warns at every commit and runs it anyway. Each neighbor is a BGP group of its own, because a group has only one type, internal or external.
- **A neighbor means what it means on every platform.** In Circuit, a neighbor without `import` accepts nothing and one without `export` announces nothing, so on Junos a session without either policy is given one that rejects everything. An export starts with a policy that lets through only BGP's routes and the prefixes in `routing.bgp.networks`, so the switch's own routes never leak. A call to another policy is written out in place, rule by rule.
- **A prefix set from a registry** is a prefix list that `refresh` fills. A plan leaves its entries alone.
- **Hardware ACLs** are filters on the port. A switched port matches IPv4 and IPv6 in one filter; a routed port has one filter per family. A rule with a `rate` goes through a policer. Every ACL ends by accepting what no rule matched.
