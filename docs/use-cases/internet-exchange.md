# Running an internet exchange

An internet exchange, IX, is a shared network where networks connect to each other directly. Each member plugs a port into the exchange's switches and gets an address on one shared subnet, the peering LAN. Members then exchange routes over BGP, with each other, or all at once through the exchange's route servers.

An exchange has two parts:

1. **The fabric**: the switches that carry the peering LAN to every member port. Circuit configures it.
2. **The route servers**: servers running BGP software, BIRD or OpenBGPD, which pass every member's routes to every other member. Circuit writes their config from the member list, and you copy it to them.

The example is an exchange of two switches, with Cloudflare, Akamai and a small network, Acme, as members.

## What a member port must do

Members share one LAN and do not trust each other. So each member port:

1. **Carries the peering VLAN and nothing else.** A member never reaches the exchange's management network.
2. **Takes no part in spanning tree,** so a member's switch never changes the exchange's topology.
3. **Sends no LLDP,** so members learn nothing about the exchange's own devices.
4. **Lets only a little broadcast, multicast and unknown unicast through**, 1% of its speed. A loop at one member does not flood the others.

The switches have no address on the peering LAN. They only carry it.

## Exchange.build

The `Exchange.build` helper makes member ports and a check from a list of members:

| Field           | What it is                                                                                          |
| --------------- | --------------------------------------------------------------------------------------------------- |
| `vlan`          | The name of the peering VLAN on the fabric switches                                                 |
| `lan`           | The peering LAN's subnets, `ipv4` and `ipv6`                                                        |
| `reserved`      | Addresses no member may take, such as the route servers'                                            |
| `storm_percent` | How much broadcast, multicast and unknown unicast a member port lets through. 1 if you leave it out |
| `mac_limit`     | The most MAC addresses a member port learns, usually 1. Not on RouterOS, see below                  |
| `ethertypes`    | The only kinds of frame a member port takes in, usually `ipv4`, `ipv6` and `arp`                    |

It returns four things:

- **`exchange.ports(device)`:** every member's port on that switch, set up as above. Put it in the switch's `ports`.
- **`exchange.check`:** a check that no two members share a name, an AS or an address, that every address is inside the peering LAN and not reserved, and that every member port carries only the peering VLAN. Put it in `checks`.
- **`exchange.bird(server)`:** a route server's config, for BIRD 2. See [The route servers](#the-route-servers).
- **`exchange.openbgpd(server)`:** the same route server's config, for OpenBGPD. See [OpenBGPD](#openbgpd).

<<< @/../examples/use-cases/internet-exchange/exchange.ts

## A member

One file per member: its name, its AS, its port on the switch it plugs into, and its addresses on the peering LAN.

<<< @/../examples/use-cases/internet-exchange/members/cloudflare.ts

<<< @/../examples/use-cases/internet-exchange/members/index.ts

A member joins by being added to `members/index.ts`, and leaves by being removed. The next apply shuts its port.

## The first switch

`ix-sw-01` has Cloudflare's port, the two route servers, the way in for management, and a trunk to the second switch.

<<< @/../examples/use-cases/internet-exchange/ix-sw-01.ts

## More than one switch

`ix-sw-02` has Akamai and Acme. It reaches the rest of the exchange over one trunk to `ix-sw-01`, port `40g-5` on both, which carries the peering LAN and management.

<<< @/../examples/use-cases/internet-exchange/ix-sw-02.ts

1. **Each member's file says which switch it plugs into.** `exchange.ports("ix-sw-02")` only returns the ports on `ix-sw-02`.
2. **`link` on both ends of the trunk** tells Circuit the two ports are connected. `circuit validate` then checks that both ends carry the same VLANs.
3. **Management goes over the same trunk,** and stays off every member port: `exchange.check` makes sure of that.

<<< @/../examples/use-cases/internet-exchange/circuit.config.ts

## The route servers

A route server peers with every member, takes each member's routes, and passes them on to all the others. A member then needs one or two sessions, to the route servers, instead of one to every other member.

Circuit never logs in to a route server. It writes the server's config from the member list, and you copy the file to the server. It writes for two kinds of routing software: BIRD 2, and OpenBGPD, the BGP daemon from OpenBSD that also runs on Linux. Both get the same sessions and the same rules; pick the one your servers run.

Each route server is a few lines in `exchange.ts`. Their addresses are also the exchange's `reserved` addresses, so no member can take one:

| Field       | What it is                                                                     |
| ----------- | ------------------------------------------------------------------------------ |
| `name`      | Its name, such as `rs1`, written at the top of its config                      |
| `asn`       | Its own AS. It never adds this AS to a path, so members see each other's paths |
| `router_id` | Its BGP router ID, an IPv4 address of the server, usually its `ipv4`           |
| `ipv4`      | Its IPv4 address on the peering LAN. Members with an IPv4 address peer with it |
| `ipv6`      | Its IPv6 address on the peering LAN. Members with an IPv6 address peer with it |

`route-servers.ts` writes each one's config beside it, once for BIRD and once for OpenBGPD. Run it with `bun route-servers.ts`, or with `npx tsx route-servers.ts` on Node:

<<< @/../examples/use-cases/internet-exchange/route-servers.ts

Each config has one BGP session per member and family. Each session keeps a route the member sends only when:

1. the first AS in its path is the member's own,
2. its next hop is the member's own address on the peering LAN, so a member cannot send traffic toward another member's router,
3. it is not the peering LAN itself, or a part of it,
4. it is /8 to /24 long for IPv4, or /12 to /48 for IPv6.

A route that fails stays on the server, hidden. Here is the BIRD session for one member; `birdc show route filtered` lists the routes it did not keep:

```
protocol bgp cloudflare_ipv4 {
    description "cloudflare, AS13335";
    local 203.0.113.1 as 64500;
    neighbor 203.0.113.10 as 13335;
    rs client;
    ipv4 {
        import keep filtered on;
        import filter {
            if bgp_path.first != 13335 then reject;
            if bgp_next_hop != 203.0.113.10 then reject;
            if net ~ [ 203.0.113.0/24+ ] then reject;
            if net.len < 8 || net.len > 24 then reject;
            accept;
        };
        export all;
    };
}
```

When a member joins or leaves, run the script again, copy the files, and run `birdc configure` on each server. BIRD starts the new sessions, stops the old ones, and keeps the sessions it did not change up.

A member's router must accept a path that does not start with the route server's AS, since the server never adds it. Many routers refuse such a path by default, with a setting called something like "enforce first AS": the member turns it off on its sessions to the route servers. On OpenBGPD it is `enforce neighbor-as no`.

### OpenBGPD

The OpenBGPD config, `bgpd.conf`, uses OpenBGPD's own way to say the same thing. It was checked with `bgpd -n`, and run with member routers in a test lab, on OpenBGPD 9.1.

1. **`transparent-as yes`** makes it a route server: it never adds its own AS to a path, and passes MED and communities on as they came.
2. **`fib-update no`** keeps the routes out of the server's own routing table, since it carries no traffic.
3. **One group per family**, `"ipv4 members"` and `"ipv6 members"`, holds a session for each member with an address in that family.
4. **Four filter rules** hold the four checks for every member at once: an `allow` per family and a `deny` per peering LAN subnet. `neighbor-as` is the AS of the session the route came in on, and `nexthop neighbor` is that session's address. In OpenBGPD the last rule a route matches decides, and a route no rule allows is dropped:

```
allow from group "ipv4 members" peer-as neighbor-as nexthop neighbor prefix 0.0.0.0/0 prefixlen 8 - 24
allow from group "ipv6 members" peer-as neighbor-as nexthop neighbor prefix ::/0 prefixlen 12 - 48
deny from any prefix 203.0.113.0/24 or-longer
deny from any prefix 2001:db8:ffff::/64 or-longer
```

Each group has `enforce neighbor-as no`. OpenBGPD checks the first AS on its own by default, but a single route that fails that check closes the member's whole session. With the check in the rules, only that route is dropped, as with BIRD.

`rde rib Loc-RIB include filtered` keeps the routes that fail visible: `bgpctl show rib filtered` lists them. When a member joins or leaves, run the script again, copy the files, and run `bgpctl reload` on each server. Like BIRD, OpenBGPD starts the new sessions, stops the old ones, and keeps the others up.

### What neither config does

Neither config checks routes against IRR or RPKI, and neither has a prefix limit per member. A large exchange wants both: add them in your own script after `exchange.bird` or `exchange.openbgpd` writes the rest, or use a route server tool built for them. A change by hand in the written file is lost the next time the script runs.

## A virtual exchange

A virtual exchange, such as BGP.Exchange, has no shared switch. Each member reaches it over a tunnel from anywhere, and peers with the route servers through that tunnel.

In the example, a hub router is the far end of one GRE tunnel per member. Each tunnel has a `/31`: the hub takes the even address, the member the odd one. The route servers sit on a LAN behind the hub. Members peer with the route servers through their tunnel, and traffic between two members goes through the hub.

A member's file:

<<< @/../examples/use-cases/virtual-exchange/members/acme.ts

The tunnels, one per member:

<<< @/../examples/use-cases/virtual-exchange/exchange.ts

The hub. Its firewall accepts GRE only from members' addresses, and lets traffic pass only inside the exchange's own space:

<<< @/../examples/use-cases/virtual-exchange/hub-01.ts

<<< @/../examples/use-cases/virtual-exchange/circuit.config.ts

## MAC limits and ethertype filters

Two more settings keep members apart:

- **`mac_limit`** is the most MAC addresses a port learns. With 1, a member sends from one router only, so a member's switch cannot leak other devices onto the peering LAN.
- **`ethertypes`** is the kinds of frame a port takes in. With `["ipv4", "ipv6", "arp"]`, anything else, such as spanning tree from a member's switch, is dropped.

Both are fields of a port or a LAG, and `Exchange.build` puts them on every member port when you set them. Where each works, as proved on a real switch:

| Platform     | `mac_limit`                | `ethertypes`                              |
| ------------ | -------------------------- | ----------------------------------------- |
| Junos        | on a switched port or LAG  | on a switched port or LAG, without an ACL |
| VRP          | on a port, not a LAG       | on a port, not a LAG                      |
| Raisecom ROS | on a port, not a LAG       | on a port, not a LAG                      |
| RouterOS     | no: 7.23 has no such limit | on a port, in the switch chip             |
| FortiOS      | no: its ports are routed   | no: its ports are routed                  |

Where a platform can't do one, `circuit validate` refuses it rather than skip it.
