---
description: Keep your network's presence at each internet exchange on PeeringDB in sync with your project.
---

# PeeringDB

`circuit sync peeringdb` keeps your presence at each exchange on [PeeringDB](https://www.peeringdb.com) in sync with your project: the speed, the IPv4 and IPv6 addresses, and whether you peer with the route servers. [How sync works](/integrations/) explains the plan, CI, and several networks.

## What it reads

- `asn` in `circuit.ts`.
- The `name`, `speed`, and addresses of each port or interface with an `exchange` that has a `peeringdb_ixlan`.
- Whether the device has a BGP neighbor with `role: "rs"` on that interface's subnet, set on the neighbor or its group. That is the route server flag.
- Your presences on PeeringDB, from its public API, which needs no key.

## What it sends

With your API key, Circuit adds each new presence and changes each one that differs. It never deletes a presence, and never changes `operational`. If PeeringDB has a presence that the project doesn't, the plan lists it under **Left alone**, so you can remove it by hand.

Circuit publishes only global addresses. The plan lists a private or shared address under Left alone, and Circuit doesn't send a presence without a global address.

## Before you start

1. **Your network has a record on PeeringDB.** Circuit adds presences to it, but doesn't make the record.
2. **Make an API key** on PeeringDB, under your profile, with write access to your network.
3. **Find the ID of each exchange LAN** on the exchange's page on PeeringDB. It is the `ixlan_id`.

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

Write your real, global addresses. Circuit doesn't publish documentation addresses like these.

Then set the key:

```sh
circuit secrets set PEERINGDB_API_KEY
```

## Sync PeeringDB

`circuit sync peeringdb` shows a plan such as this one, then asks:

```
PeeringDB (AS64500): 2 change(s)
  + DE-CIX Frankfurt: 25000 Mbit/s, route server yes, 192.0.2.10, 2001:db8:ffff::10
  ~ AMS-IX (edge-01 ams-ix)
      speed: 10000 to 100000 Mbit/s

Left alone:
  LINX LON1 (203.0.113.99) is on PeeringDB but not in the project. Remove it there by hand if you left.
  edge-02 exchange-b: 10.255.0.5 is not a global address, so it is not published.
```
