# Glossary

Short explanations of the networking and Circuit words these pages use.

## Circuit

| Word     | Meaning                                                                                                     |
| -------- | ----------------------------------------------------------------------------------------------------------- |
| Platform | The operating system of a device, such as `routeros` for MikroTik. It decides which commands Circuit sends. |
| Adapter  | The part of Circuit that speaks one platform's language.                                                    |
| Plan     | The list of commands that would make a device match its file. `diff` and `apply` print it.                  |
| Snapshot | What a device ran when Circuit last read it, saved in `.circuit/state/`.                                    |
| Check    | A rule about your network that every change must pass. See [Checks](/guide/network#checks).                 |
| Preset   | A ready-made building block, such as a filter or a check. See [Presets](/guide/presets).                    |
| Pattern  | A ready-made layout for a kind of network, with example devices. See [Patterns](/patterns/).                |

## Networking

| Word                  | Meaning                                                                                                                       |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| VLAN                  | A separate network on the same cables, told apart by a number from 1 to 4094.                                                 |
| Access port           | A port in one VLAN, for a device that knows nothing about VLANs, such as a PC.                                                |
| Trunk port            | A port that carries several VLANs, each frame tagged with its VLAN number. Used between switches and routers.                 |
| LAG                   | Several ports joined into one link, for more speed or for a spare. Also called a bond or a port channel.                      |
| Management network    | The network you log in to the devices from. Lose it, and you lose access.                                                     |
| NAT                   | Rewriting addresses as traffic passes, for example so a whole home shares one public address.                                 |
| ACL                   | A list of rules in a switch chip that drops or limits traffic before it reaches the CPU.                                      |
| AS, AS number         | A network with its own routing policy on the internet, and the number that identifies it.                                     |
| BGP                   | The protocol networks use to tell each other which addresses they can reach.                                                  |
| Prefix                | A block of addresses, such as `198.51.100.0/24`.                                                                              |
| IP transit            | A paid connection to the whole internet, bought from a bigger network.                                                        |
| IX-only transit       | Only the routes learned at internet exchanges, sold more cheaply than full transit. Often called content or domestic transit. |
| Internet exchange, IX | A place where many networks connect to each other directly, usually without paying each other.                                |
| Peering LAN           | The one subnet every member of an internet exchange has an address on.                                                        |
| Route server          | A router at an exchange that passes routes between every network there, so you need one session instead of hundreds.          |
| BGP community         | A tag on a route, to remember where it came from or to ask a neighbor to do something with it.                                |
| RPKI                  | Signed records that say which AS may announce a prefix. A route that breaks them is invalid.                                  |
| Spoofing              | Sending traffic with a forged source address.                                                                                 |
| Tenant                | A customer who gets their own networks inside yours, such as in a colocation.                                                 |
| PeeringDB             | A public database of networks and the exchanges they are on.                                                                  |
