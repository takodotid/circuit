# An edge router

Your own AS number and address space, announced to the internet through an IP transit and an internet exchange. The router is where traffic from outside is filtered, before it reaches the rest of your network.

```bash
bunx @takodotid/circuit new my-network --pattern edge-router --asn 64500
```

```
my-network/
  circuit.config.ts    the devices, the checks, and what is published
  routing.ts           your AS number and BGP communities
  edge-01.ts           the router
  checks.ts            rules of your own
  .env                 the router's password, never committed
  .circuit/            what Circuit writes
```

## routing.ts

Your AS number, and what your BGP communities mean. The router tags every route it learns with where it came from, and `circuit communities` publishes the same list. See [communityScheme](/guide/presets#bgp-communities).

<<< @/../templates/edge-router/routing.ts

## edge-01.ts

<<< @/../templates/edge-router/edge-01.ts

What it does, from top to bottom:

1. **Ports.** `1g-1` is for management. The transit and the exchange each arrive on their own port and VLAN, and both ports use the `edge` ACL.
2. **Routing.** A blackhole route for each of your blocks puts them in the routing table even when nothing inside is up, so they are always announced. `max_prefixes` closes a session that suddenly sends far more routes than expected. `local_role` turns on RFC 9234, so both sides reject a route leak.
3. **Policies.** Every import first calls `SANITY`, which refuses routes that should never be on the internet. Routes from the exchange get a higher local preference than the same routes from the transit, so traffic to those networks takes the exchange, which is usually cheaper and closer. The export only accepts your own blocks, then rejects everything else.
4. **Firewall.** The router itself only answers replies, ping, the management network, and BGP from its neighbors. Forwarded traffic loses packets with impossible TCP flags.
5. **ACLs.** Traffic from outside with a forged source, such as your own space or a private address, is dropped in the switch chip.

Change the addresses, the neighbors' AS numbers and the port names to your own.

## checks.ts

<<< @/../templates/edge-router/checks.ts

## circuit.config.ts

<<< @/../templates/edge-router/circuit.config.ts

To publish your exchanges on PeeringDB as well, see [Publishing the network](/guide/publishing).

## Next

1. Put the router's password in `.env`, then run `bun circuit secrets`.
2. Run `bun circuit validate`, `bun circuit snapshot` and `bun circuit diff`.
3. Run `bun circuit apply edge-01`, read the plan, then add `--confirm`.

To host customers behind the router, see [Colocation with tenants](/patterns/colocation).
