# Running an internet exchange

An internet exchange, IX, is a shared network where networks connect to each other directly. Each member plugs a port into the exchange's switches and gets an address on one shared subnet, the peering LAN. Members then exchange routes over BGP, with each other, or all at once through the exchange's route servers.

An exchange has two parts:

1. **The fabric**: the switches that carry the peering LAN to every member port. Circuit configures it.
2. **The route servers**: servers running BGP software such as BIRD, which pass every member's routes to every other member. Circuit does not configure these yet.

## What a member port must do

Members share one LAN and do not trust each other. So each member port:

1. **Carries the peering VLAN and nothing else.** A member never reaches the exchange's management network.
2. **Takes no part in spanning tree,** so a member's switch never changes the exchange's topology.
3. **Sends no LLDP,** so members learn nothing about the exchange's own devices.
4. **Lets only a little broadcast, multicast and unknown unicast through**, 1% of its speed. A loop at one member does not flood the others.

The switch has no address on the peering LAN. It only carries it.

## internetExchange

The `internetExchange` preset builds member ports and a check from a list of members:

```ts
import { internetExchange } from "@takodotid/circuit/presets";

const exchange = internetExchange({ vlan: "peering", lan: { ipv4: "203.0.113.0/24" }, reserved: ["203.0.113.1"] }, MEMBERS);
```

| Field           | What it is                                                                                  |
| --------------- | ------------------------------------------------------------------------------------------- |
| `vlan`          | The name of the peering VLAN on the fabric switches                                         |
| `lan`           | The peering LAN's subnets, `ipv4` and `ipv6`                                                |
| `reserved`      | Addresses no member may take, such as the route servers'                                    |
| `storm_percent` | How much broadcast, multicast and unknown unicast a member port lets through. 1 when absent |

It returns two things:

- **`exchange.ports(device)`:** every member's port on that switch, set up as above. Put it in the switch's `ports`.
- **`exchange.check`:** a check that no two members share a name, an AS or an address, that every address is inside the peering LAN and not reserved, and that every member port carries the peering VLAN alone. Put it in `checks`.

## A member

One file per member, with its name, its AS, its port on each switch and its addresses on the peering LAN:

<<< @/../examples/use-cases/internet-exchange/members/example-isp.ts

<<< @/../examples/use-cases/internet-exchange/members/index.ts

A member joins by being added to `members/index.ts` and leaves by being removed. The next apply shuts its port.

## The files

<<< @/../examples/use-cases/internet-exchange/exchange.ts

<<< @/../examples/use-cases/internet-exchange/ix-sw-01.ts

<<< @/../examples/use-cases/internet-exchange/circuit.config.ts

## More than one switch

Add a file for each switch, and give each member's `ports` the switch it plugs into. Connect the switches with trunks that carry the peering VLAN, with `link` on both ends, so `circuit validate` checks that both ends agree.

## A virtual exchange

A virtual exchange, such as BGP.Exchange, has no shared switch. Each member reaches it over a tunnel instead, from anywhere, and peers with its route servers through the tunnel.

**To join one,** add the tunnel and the BGP sessions to your router. The exchange gives you the tunnel's far end and your address inside it:

```ts
interfaces: {
    "vix-tunnel": {
        type: "gre",
        local: "198.51.100.1",
        remote: "192.0.2.50",
        addresses: ["10.255.0.10/24"],
    },
},
```

and a BGP neighbor with `role: "rs"` for each route server, at its address inside the tunnel. Add the `tunnelsOutsideOffered` check from the [presets](/guide/presets#checks). If your tunnel starts from an address inside a prefix you announce to the exchange, the exchange's replies would come back through the tunnel itself, and the tunnel would break.

**To run one,** you need a tunnel to each member on a router, and route servers. Circuit can configure the tunnels on a RouterOS router, one GRE or WireGuard interface per member. The route servers are the same gap as above.

## Not in Circuit yet

- **Route servers.** The member list holds what they need, each member's AS and addresses, but turning it into BIRD config is up to you for now.
- **A MAC address limit per member port,** which stops a member from sending from more than one MAC address.
- **An ethertype filter per member port,** which lets only IPv4, IPv6 and ARP through.

All three are on Circuit's list. Until they are in, anything set by hand on the switch is removed by the next apply, because the file is the whole truth. So an exchange that needs MAC limits or ethertype filters today cannot manage its fabric with Circuit yet. A small or test exchange can.
