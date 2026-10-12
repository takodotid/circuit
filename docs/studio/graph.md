# The graph

The graph draws your network from your files, one layer at a time: which cable goes where, which VLANs each one carries, which devices share an address range, and every BGP session, OSPF neighbor and tunnel.

<img class="screenshot light" src="/screenshots/studio-light.png" alt="Studio's VLAN graph with devices that differ from their snapshots marked by orange dashed borders, beside the layer details and legend.">
<img class="screenshot dark" src="/screenshots/studio-dark.png" alt="Studio's VLAN graph with devices that differ from their snapshots marked by orange dashed borders, beside the layer details and legend.">

1. Pick a layer below the top bar. The keys 1 to 6 do the same.
2. Click a device or a line to see everything about it on the right. **Everything it holds** opens the device's page.
3. On the VLANs layer, pick a VLAN on the right to light up every cable that carries it.

More than three lines between the same two devices are drawn as one, such as **18 shared prefixes**. Click it to list them all.

Drag a device to move it, drag the empty space to move the whole drawing, and scroll to zoom. A network too large to read whole opens on its busiest device; **Fit** shows all of it. Your browser remembers where you put each device. **Lay out again** forgets that and starts over. **Save image** saves the layer shown, as it looks, as an SVG or a PNG. The Circuit Studio name at the top left always brings you back to the graph.

## The layers

| Layer     | Button    | What it draws                                                                                                                                            |
| --------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `l1`      | Cables    | Each cable a port's `link` names. The cables of one [LAG](/guide/glossary#networking) are one line.                                                      |
| `l2`      | VLANs     | The VLANs each cable carries.                                                                                                                            |
| `l3`      | Addresses | Address ranges that two or more devices have an address in, and point-to-point addresses. A range only one device uses, such as a loopback, is left out. |
| `bgp`     | BGP       | Sessions between your devices, matched by the address each one names, and sessions to every network outside, one box per AS.                             |
| `ospf`    | OSPF      | Two devices with OSPF in the same area on the same address range, where neither side is passive.                                                         |
| `tunnels` | Tunnels   | GRE and VXLAN tunnels, matched by their endpoints, and WireGuard peers. Peers that dial in to a device are one box.                                      |

## What is marked

- **A device with a thick red border** has an error that `circuit validate` would print.
- **A device with an orange dashed border** has a warning, or differs from its last snapshot. Click it to see what `circuit diff` would send.
- **An orange dashed line** is declared by one end only: a cable whose far port does not name it back, a BGP session the other device does not have, or a tunnel with no tunnel back.
- **A device filled yellow** is the one you selected.
- **A dashed box** is outside the network: another AS, a tunnel's far end, or a device a `link` names that is not in `circuit.config.ts`.

The drawing shows what your files say, not what is plugged in. A cable in the wrong port looks right here.

To print a layer as text instead, for a pull request or an image, see [Printing the graph](/guide/graph).
