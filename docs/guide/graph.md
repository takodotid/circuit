# Seeing the network

Circuit can draw your network from your files: which cable goes where, which VLANs each one carries, which devices share an address range, and every BGP session, OSPF neighbor and tunnel. Use it to learn how a network is laid out, or to find out why something does not reach where it should.

It reads only your files and the last [snapshot](/guide/glossary#circuit), and never logs in to a device, so it is safe to run at any time. There is nothing to write: run a command.

`circuit graph` prints it as text, for a pull request, an image or a script.

## The layers

| Layer     | What it draws                                                                                                                                            |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `l1`      | Each cable a port's `link` names. The cables of one [LAG](/guide/glossary#networking) are one line.                                                      |
| `l2`      | The VLANs each cable carries.                                                                                                                            |
| `l3`      | Address ranges that two or more devices have an address in, and point-to-point addresses. A range only one device uses, such as a loopback, is left out. |
| `bgp`     | Sessions between your devices, matched by the address each one names, and sessions to every network outside, one box per AS.                             |
| `ospf`    | Two devices with OSPF in the same area on the same address range, where neither side is passive.                                                         |
| `tunnels` | GRE and VXLAN tunnels, matched by their endpoints, and WireGuard peers. Peers that dial in to a device are one box.                                      |

## What is marked

- **A red device** has an error that `circuit validate` would print.
- **An amber device** has a warning, or differs from its last snapshot.
- **An amber dashed line** is declared by one end only: a cable whose far port does not name it back, a BGP session the other device does not have, or a tunnel with no tunnel back.
- **A dashed box** is outside the network: another AS, a tunnel's far end, or a device a `link` names that is not in `circuit.config.ts`.

The drawing shows what your files say, not what is plugged in. A cable in the wrong port looks right here.

## As text

`circuit graph` prints one layer, cables by default:

```bash
npx circuit graph                           # the cables, as Mermaid
npx circuit graph --layer=bgp               # BGP sessions
npx circuit graph --layer=l2,l3 edge-01     # VLANs and addresses, only around edge-01
npx circuit graph --layer=all --format=json # everything, for a script or an AI agent
```

| Format    | For                                                                                                                                               |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mermaid` | Pasting into a pull request, an issue or a README on GitHub, in a code block marked `mermaid`. GitHub draws it.                                   |
| `dot`     | dot -Tsvg > network.svg`.                                                                                                                         |
| `json`    | Scripts and AI agents. It holds every node and line with its details, what `validate` found, and how each device compares with its last snapshot. |

Name devices after the command to draw only what touches them.
