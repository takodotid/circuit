# A single site

One router and one switch: a home, an office, or an internal network. The router connects to the internet through your provider, and shares its one public address with everything behind it. There is no BGP, so there is no AS number either.

```bash
npx @takodotid/circuit new my-network --pattern single-site
```

```
my-network/
  circuit.config.ts    the devices and the checks
  site.ts              values both devices share
  router.ts
  switch.ts
  checks.ts            rules of your own
  .env                 the devices' passwords, never committed
  .circuit/            what Circuit writes
```

There are three VLANs: `mgmt` for logging in to the devices, `home` for your own devices, and `guests` for visitors, kept off the other two.

## site.ts

Values both devices use. Change them first: your management network, the router's address on it, your timezone, and your VLANs.

<<< @/../templates/single-site/site.ts

## router.ts

The router has the internet connection on its `1g-1` port, and a trunk with all three VLANs to the switch. For each VLAN it is the gateway and the DHCP server. The firewall lets replies back in, keeps guests away from the other VLANs, and only lets the management network log in. NAT shares the public address.

<<< @/../templates/single-site/router.ts

Change the address of `1g-1` and the default route to what your provider gave you.

## switch.ts

The switch has a port for each device on the site, in the VLAN it belongs to. `stp: { edge: true }` marks a port with a single device on it, so it comes up at once instead of waiting for spanning tree.

<<< @/../templates/single-site/switch.ts

`link` on both ends of the cable tells Circuit the two ports are connected. `circuit validate` then makes sure both ends carry the same VLANs.

## checks.ts

Two rules of your own: every port has a description, and no access port gives the management network to whatever is plugged in. See [Checks](/guide/network#checks).

<<< @/../templates/single-site/checks.ts

## circuit.config.ts

<<< @/../templates/single-site/circuit.config.ts

Without BGP, the network needs no `asn`.

## Next

1. Put the two passwords in `.env`, then run `npx circuit secrets`.
2. Run `npx circuit validate`, then `npx circuit snapshot` and `npx circuit diff`.
3. Apply the switch first, then the router: `npx circuit apply switch`, read the plan, then add `--confirm`.

When you get your own AS number, see [An edge router](/patterns/edge-router).
