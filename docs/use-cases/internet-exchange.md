# Running an internet exchange

An internet exchange, IX, is a shared network where networks connect to each other directly. Each member plugs a port into the exchange's switches and gets an address on one shared subnet, the peering LAN. Members then exchange routes over BGP, with each other, or all at once through the exchange's route servers.

An exchange has two parts:

1. **The fabric**: the switches that carry the peering LAN to every member port. Circuit configures it.
2. **The route servers**: servers running BGP software such as BIRD, which pass every member's routes to every other member. Circuit does not configure these yet.

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
| `mac_limit`     | The most MAC addresses a member port learns, usually 1. Not on any platform yet, see below          |
| `ethertypes`    | The only kinds of frame a member port takes in, usually `ipv4`, `ipv6` and `arp`. Not yet either    |

It returns two things:

- **`exchange.ports(device)`:** every member's port on that switch, set up as above. Put it in the switch's `ports`.
- **`exchange.check`:** a check that no two members share a name, an AS or an address, that every address is inside the peering LAN and not reserved, and that every member port carries only the peering VLAN. Put it in `checks`.

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

Both are fields of a port or a LAG, and `Exchange.build` puts them on every member port when you set them. But no platform can do them yet: the commands for them have not been proved on a real device, so `circuit validate` refuses both, on every platform. Each is added once its commands are proved, in [issue #16](https://github.com/takodotid/circuit/issues/16).

Until then, anything set by hand on a switch is removed by the next apply, because the file is the whole truth. So an exchange that needs MAC limits or ethertype filters today cannot manage its fabric with Circuit yet. A small or test exchange can.
