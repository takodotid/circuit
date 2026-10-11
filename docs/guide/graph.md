# Seeing the network

Circuit can draw your network from your files: which cable goes where, which VLANs each one carries, which devices share an address range, and every BGP session, OSPF neighbor and tunnel. Use it to learn how a network is laid out, or to find out why something does not reach where it should.

It reads only your files and the last [snapshot](/guide/glossary#circuit), and never logs in to a device, so it is safe to run at any time. There is nothing to write: run a command.

- `circuit studio` draws the network in your browser, with tables of everything your files hold, and shows it again each time you save a file.
- `circuit graph` prints it as text, for a pull request, an image or a script.

## In the browser

<img class="screenshot light" src="/screenshots/studio-light.png" alt="Circuit studio showing the cables between five devices. One device is outlined in amber because it differs from its last snapshot.">
<img class="screenshot dark" src="/screenshots/studio-dark.png" alt="Circuit studio showing the cables between five devices. One device is outlined in amber because it differs from its last snapshot.">

1. Run `npx circuit studio` in your project.
2. Your browser opens the drawing, at `http://127.0.0.1:4600`.
3. Pick a layer below the top bar: cables, VLANs, addresses, BGP, OSPF or tunnels. The keys 1 to 6 do the same.
4. Click a device or a line to see everything about it on the right.
5. Edit a device's file and save it. The drawing changes within a second.

Drag a device to move it, drag the empty space to move the whole drawing, and scroll to zoom. Your browser remembers where you put each device. **Lay out again** forgets that and starts over.

Studio answers only on your own machine: nobody else on the network can open it. Stop it with Ctrl+C. To use another port, run `npx circuit studio --port=5000`. To stop it opening the browser, add `--no-open`.

## Looking things up

Next to the graph, the top bar has tables of everything your files hold. You can read a network with them without reading TypeScript.

<img class="screenshot light" src="/screenshots/studio-device-light.png" alt="A device's page in Circuit studio, listing every port of its model: the ones the config declares with their VLANs, addresses, LAG and the device at the other end, and the rest as shut down.">
<img class="screenshot dark" src="/screenshots/studio-device-dark.png" alt="A device's page in Circuit studio, listing every port of its model: the ones the config declares with their VLANs, addresses, LAG and the device at the other end, and the rest as shut down.">

| View      | What it lists                                                                                                                                                                                                                                                              |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Devices   | Every device. Each has a page per part: ports, including those the config leaves shut; interfaces; VLANs; routing; policies; firewall; users and ways in; DHCP and flow export; the config it would run, as `circuit build` prints it; and what `circuit diff` would send. |
| VLANs     | Every VLAN, the devices that declare it, its gateways, and the ports that carry it.                                                                                                                                                                                        |
| Addresses | Every address in use and what is free, as [`circuit addresses`](/guide/addresses) prints it.                                                                                                                                                                               |
| BGP       | Every session, with its group's settings filled in, and what is at the far end.                                                                                                                                                                                            |
| Cables    | Every cable, with the VLANs it carries.                                                                                                                                                                                                                                    |

**Search** in the top bar finds a name, an address or any other value in any device. Point at a column's name to see what that field means; it is the same text your editor shows.

A secret shows as the name its value is read from, such as `secret("EDGE_01_PASSWORD")`, never as the value. Studio only reads. To change something, edit the device's file, and studio shows the change when you save it.

Each page has its own address, such as `http://127.0.0.1:4600/#devices/edge-01/ports`, so the browser's back button works and a bookmark opens the same page. `npx circuit studio --json` prints everything studio shows as JSON, for a script.

## The layers

| Layer     | Name in studio | What it draws                                                                                                                                            |
| --------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `l1`      | Cables         | Each cable a port's `link` names. The cables of one [LAG](/guide/glossary#networking) are one line.                                                      |
| `l2`      | VLANs          | The VLANs each cable carries. In studio, pick a VLAN to light up every cable that carries it.                                                            |
| `l3`      | Addresses      | Address ranges that two or more devices have an address in, and point-to-point addresses. A range only one device uses, such as a loopback, is left out. |
| `bgp`     | BGP            | Sessions between your devices, matched by the address each one names, and sessions to every network outside, one box per AS.                             |
| `ospf`    | OSPF           | Two devices with OSPF in the same area on the same address range, where neither side is passive.                                                         |
| `tunnels` | Tunnels        | GRE and VXLAN tunnels, matched by their endpoints, and WireGuard peers. Peers that dial in to a device are one box.                                      |

## What is marked

- **A red device** has an error that `circuit validate` would print.
- **An amber device** has a warning, or differs from its last snapshot. In studio, click it to see what `circuit diff` would send.
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
| `dot`     | An image, with [Graphviz](https://graphviz.org): `npx circuit graph --format=dot \| dot -Tsvg > network.svg`.                                     |
| `json`    | Scripts and AI agents. It holds every node and line with its details, what `validate` found, and how each device compares with its last snapshot. |

Name devices after the command to draw only what touches them.
