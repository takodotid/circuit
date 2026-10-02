# How a device converges

`apply` reads the device, plans the difference between what it runs and what the config renders, and sends the plan. Nothing the device runs is kept unless the config describes it.

## Order

Plans run in two phases. Additions and changes go first, in dependency order, so a VLAN exists before a port joins it. Removals go last, in reverse, so nothing is removed while something still uses it.

An ordered list, such as a firewall chain or a route policy, is replaced whole. The old rules keep deciding until the new ones are in place, then the old ones are removed.

## Guards

Each adapter guards the apply the way its platform allows:

| Platform       | Commit                     | If it goes wrong                                                          |
| -------------- | -------------------------- | ------------------------------------------------------------------------- |
| `routeros`     | each command as sent       | backup saved, a scheduler restores it unless a fresh login disarms it     |
| `vrp`          | `commit`, then `save`      | nothing applies until commit; save only after a fresh login proves access |
| `raisecom-ros` | each command, then `write` | write only after a fresh login proves access                              |

A fresh login after the change is the proof that management access survived it. Until that proof, a RouterOS device restores itself on its own, and a VRP or Raisecom device returns to its saved configuration on its next restart.

Before anything is sent to RouterOS, every command is compiled on the device without running, so a syntax error or an unknown property costs nothing. VRP stages every line in a candidate configuration that is discarded on the first refusal.

## Versions

An adapter renders for one major version of its platform and refuses another when it connects. `routeros` is RouterOS 7; RouterOS 6 has a different BGP and filter language and would be an adapter of its own.
