# Questions

## How do I rename a device?

1. Change `name` in the device's file. Circuit sets it as the device's hostname.
2. Change every place that refers to the old name: a `link` on the device at the other end of a cable, and any check that names the device, such as `routers` in `trustBoundary`. `circuit validate` reports a `link` to a device that does not exist.
3. Rename the file too if you like. It only matters to you; Circuit goes by `name`.
4. Run `bun circuit apply <new name>`, then `--confirm`. The plan changes the hostname.
5. Run `bun circuit snapshot` with no device names. It saves the device under its new name and removes the old snapshot from `.circuit/state/`.

## How do I rename a site?

Circuit does not know about sites. A site is only a directory you made to keep files together. Rename the directory and fix the imports that point into it, usually in `circuit.config.ts`. Nothing changes on any device.

## My network has more than one AS number. What do I do?

It depends on what the AS numbers are for:

- **Different routers speak BGP as different AS numbers.** One project is enough. Each router's AS number is `routing.bgp.asn` in its own file. `asn` in `circuit.config.ts` is only used for what Circuit publishes, PeeringDB and communities.
- **Each AS has its own PeeringDB record or its own communities.** Give each AS its own config file in the same repository, such as `as64500.config.ts` and `as64501.config.ts`, and choose one with `--config`. Each config file gets its own `.circuit/` next to it, so put each in its own directory.
- **The networks are run by different teams.** Use one repository per network. Each team then has its own history, secrets and access.

## How do I sell IP transit?

A transit customer is a BGP neighbor that sends you its own routes and receives the internet from you. In the router's file:

1. Add the customer as a BGP neighbor with `role: "customer"`. Both routers then reject a route leak on their own.
2. Accept only the customer's own prefixes. Write them in a `prefix_set`, or fetch them from a registry with `source: { registry: "ripe-stat", query: "AS64510", family: "ipv4" }` and keep them current with `circuit refresh`.
3. Set `max_prefixes`, so a mistake on the customer's side closes the session instead of flooding your router.
4. Tag their routes with `communities.tag("customer", 64510, { keepActions: true })` from [`communityScheme`](/guide/communities), so they can ask you not to announce a route somewhere.
5. Export the full table, or only a default route, as you agreed with them.
6. Add their prefixes to your own export policies, so you announce them to your transits and exchanges.

## How do I host servers or content for others?

That is the [colocation pattern](/patterns/colocation): each customer gets their own VLANs, public addresses and switch ports, from one file per customer.

## Why does `trustBoundary` ask for untrusted VLANs, not trusted ones?

The untrusted list is short and rarely changes: your transits, exchanges and ISP handoffs. Your own VLANs grow every time you add a customer or a service. Listing the untrusted ones means every VLAN you add later is protected from the start, without anyone remembering to add it to the check.

## My device shows something the config does not have. Will Circuit remove it?

Only if it is part of the device's configuration. Some things a device creates on its own, and they are not configuration: for example, RouterOS shows a dynamic firewall rule called "special dummy rule to show fasttrack counters" whenever a rule uses fasttrack. Circuit leaves those alone, because they come and go with the device's own state.

## Can I use Circuit on a device that is already in production?

Yes, carefully. The first plan removes everything your file does not describe yet, so:

1. Run `bun circuit snapshot` and read the device's current configuration in `.circuit/state/`.
2. Write the file to describe what should stay.
3. Run `bun circuit diff` again, and repeat until the plan only holds changes you want.
4. Only then run `apply --confirm`.
