# The graph

The graph draws your network from your files, one layer at a time: which cable goes where, which VLANs each one carries, which devices share an address range, and every BGP session, OSPF neighbor and tunnel.

<img class="screenshot light" src="/screenshots/studio-light.png" alt="Studio's graph of cables between edge-01 and tor-01, with the layer tabs above it and the legend beside it.">
<img class="screenshot dark" src="/screenshots/studio-dark.png" alt="Studio's graph of cables between edge-01 and tor-01, with the layer tabs above it and the legend beside it.">

1. Pick a layer above the drawing. Each tab says how many lines it has.
2. Pick a device or a line to see what it is, on the right.
3. Double-click a device to open its page.

Drag a device to move it, drag the empty space to move the drawing, and scroll to zoom. **Fit** shows all of it, **Lay out again** lays the layer out again, and **Save image** saves the layer shown as a PNG.

## The layers

| Layer     | What it draws                                                                                       |
| --------- | --------------------------------------------------------------------------------------------------- |
| Cables    | Each cable a port's `link` names. The cables of one [LAG](/guide/glossary#networking) are one line. |
| VLANs     | The VLANs each cable carries, from its port or LAG.                                                 |
| Addresses | Address ranges that devices share.                                                                  |
| BGP       | Sessions between your devices, matched by address, and to each AS outside.                          |
| OSPF      | Interfaces in one area and one prefix, where neither side is passive.                               |
| Tunnels   | GRE and VXLAN tunnels, matched by their endpoints, and WireGuard peers.                             |

## What is marked

- **A dashed line** is declared at one end only: a cable whose far port does not link back, or a session the other device does not have.
- **A dashed box** is outside the network, such as another AS.
- **A box framed in orange or red** has warnings or errors, as `circuit validate` reports them.

The drawing shows what your files say, not what is plugged in. To check the cables, run `circuit diff` on the device: it compares what LLDP sees with each `link`.
