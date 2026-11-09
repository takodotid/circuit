---
description: circuit sync peeringdb keeps your exchange presence at PeeringDB in step with the project.
---

# PeeringDB

[PeeringDB](https://www.peeringdb.com) is where networks say which internet exchanges they are at, with which addresses, so others can peer with them.

`circuit sync peeringdb` keeps your network's presence at each exchange in step with your project: the speed, the IPv4 and IPv6 address, and whether you peer with the route servers.

## What it reads

- `asn` in `circuit.ts`.
- Each port or interface with an `exchange` that names a `peeringdb_ixlan`: its `name`, its `speed`, and its addresses.
- Whether the device has a BGP neighbor with `role: "rs"` (its own or its group's) on that interface's subnet. That is the route server flag.
- PeeringDB's public list of your presences, which needs no key.

## What it sends

With your API key:

- a new presence;
- a changed IPv4, IPv6, speed or route server flag.

It never deletes a presence, and never changes `operational`: leaving an exchange is decided outside the project. A presence PeeringDB has that the project doesn't is listed under **Left alone**, so you can remove it by hand.

Only global addresses are published. An exchange reached over a tunnel often lands on private or shared space, and publishing it would point others at a dead end. An address that isn't global is listed under Left alone, and a presence with no global address at all is not sent.

## Before you start

1. **Your network has a record at PeeringDB.** Circuit adds presences to it; it doesn't make the record.
2. **Make an API key** at PeeringDB, under your profile, with write access to your network.
3. **Find each exchange LAN's id** on the exchange's page at PeeringDB, the `ixlan_id`.

## Set it up

In `circuit.ts`:

```ts
export const as64500 = circuit({
    asn: 64500,
    sites: { "dc-1": {} },
    integrations: {
        peeringdb: { api_key: secret("PEERINGDB_API_KEY") },
    },
});
```

On the interface that faces the exchange:

```ts
vlan_interface: {
    "de-cix": {
        vlan: "de-cix",
        addresses: ["192.0.2.10/24", "2001:db8:ffff::10/64"],
        exchange: { name: "DE-CIX Frankfurt", speed: 25000, peeringdb_ixlan: 31 },
    },
},
```

The documentation addresses on this page stand in for your real, global ones. Written as they are here, neither would be published.

Then keep the key in your secrets, encrypted:

```sh
circuit secrets set PEERINGDB_API_KEY
```

## Bring PeeringDB in step

```sh
circuit sync peeringdb             # shows what would change, then asks
circuit sync peeringdb --confirm   # sends without asking
```

```
PeeringDB (AS64500): 2 change(s)
  + DE-CIX Frankfurt: 25000 Mbit/s, route server yes, 192.0.2.10, 2001:db8:ffff::10
  ~ AMS-IX (edge-01 ams-ix)
      speed: 10000 to 100000 Mbit/s

Left alone:
  LINX LON1 (203.0.113.99) is on PeeringDB but not in the project. Remove it there by hand if you left.
  edge-02 exchange-b: 10.255.0.5 is not a global address, so it is not published.
```

Circuit asks for your secrets' password before it reads PeeringDB, as for the other targets, though only sending uses the key.

Networks in one project with the same `asn` are planned together, so a presence one network writes is not listed as missing by the other.
