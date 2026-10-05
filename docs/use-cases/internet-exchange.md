# Running an internet exchange

An internet exchange, IX, is a shared network where many networks connect to each other directly. Each member plugs one port into the exchange's switches, and gets an address on one big subnet, the peering LAN. Members then exchange routes over BGP, either with each other one by one, or all at once through the exchange's route servers.

An exchange has two parts:

1. **The fabric**: the switches that carry the peering LAN between member ports. Circuit configures these.
2. **The route servers**: servers running BGP software such as BIRD or OpenBGPD, which pass every member's routes to every other member. Circuit does not configure these yet; they are ordinary servers on the peering LAN.

This page builds a fabric of one switch, with one file per member.

## What the fabric must do

A peering LAN is shared by networks that do not trust each other. Each member port must therefore:

1. **Be in the peering VLAN and nothing else**, so a member can never reach the exchange's management network or another member's private traffic.
2. **Not take part in spanning tree.** A member's switch must never become part of the exchange's topology. `stp: false` turns it off on the port.
3. **Not run LLDP**, so the exchange does not tell members about its own devices. `lldp: false`.
4. **Let only a trickle of broadcast, multicast and unknown unicast through.** One member's loop or misconfigured server must not flood every other member. `storm_control` at 1%.

The switch itself has no address on the peering LAN: it only carries it.

## A member

A member's file says what is its own: its name, its AS, its port on each switch, and its addresses on the peering LAN.

<<< @/../examples/use-cases/internet-exchange/members/example-isp.ts

<<< @/../examples/use-cases/internet-exchange/members/index.ts

A member joins by being added to `members/index.ts`, and leaves by being removed. The next apply shuts its port.

## The files

`exchange.ts` holds the peering LAN, what a member is, and the function that turns members into ports:

<<< @/../examples/use-cases/internet-exchange/exchange.ts

The fabric switch combines the members' ports with its own: two route servers and the management network.

<<< @/../examples/use-cases/internet-exchange/ix-sw-01.ts

The checks make sure no two members share a name, an AS or an address, every address is inside the peering LAN and not one the route servers hold, and no member port carries a second VLAN.

<<< @/../examples/use-cases/internet-exchange/checks.ts

<<< @/../examples/use-cases/internet-exchange/circuit.config.ts

## What Circuit does not do yet

Be aware of these before you run a production exchange with Circuit:

- **Route servers** are not configured by Circuit. The member list in `members/` holds what they need, each member's AS and addresses, but turning it into BIRD or OpenBGPD config is up to you for now.
- **MAC address limits per port**, which stop a member from sending from more than one MAC address, are not in Circuit's schema yet.
- **Ethertype filters**, which allow only IPv4, IPv6 and ARP on a member port, are not in the schema either.

All three are on Circuit's list. Until they are in, anything set by hand on the switch is removed by the next apply, because the file is the whole truth. So an exchange that needs MAC limits or ethertype filters today cannot manage its fabric with Circuit yet. A small or test exchange can.

## A second switch

A fabric of several switches carries the peering VLAN between them on trunks. Add a file per switch, give a member's `ports` an entry for the switch it plugs into, and add the trunk ports with `link` on both ends, so `circuit validate` checks that both carry the peering VLAN. Keep management off those trunks, or the check above, which allows the peering VLAN alone, reports them.
