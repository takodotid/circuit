---
description: Your project in the browser. The network drawn, everything in tables, no TypeScript needed.
---

# Circuit Studio

Studio shows your project in the browser: the network drawn as a graph, every device and VLAN in tables, tools to trace and test, and a compare view. Use it to find your way around a network, or to look something up without reading code.

Studio only reads your files. It touches a device only when you press **Read from the device now**, and then it only reads.

<img class="screenshot light" src="/screenshots/studio-light.png" alt="Studio's graph of cables between edge-01 and tor-01, with the layer tabs above it and the legend beside it.">
<img class="screenshot dark" src="/screenshots/studio-dark.png" alt="Studio's graph of cables between edge-01 and tor-01, with the layer tabs above it and the legend beside it.">

## Start it

1. Run `circuit studio`, or pick **Studio** in the menu.
2. Your browser opens `http://127.0.0.1:4600`.
3. Save a file, and Studio updates by itself.

Only your machine can reach it. Ctrl+C stops it.

| Option                 | What it does                                          |
| ---------------------- | ----------------------------------------------------- |
| `--port <number>`      | The port. The default is `4600`.                      |
| `--host <address>`     | Where it listens. See [Host Studio](/studio/hosting). |
| `--allow-host <names>` | The names people use to reach it, behind a proxy.     |
| `--no-open`            | Don't open the browser.                               |

Every page has its own address, like `#devices/edge-01`, so the back button and bookmarks work.

## The graph

The graph draws your network one layer at a time. Pick a layer above the drawing, or press 1 to 6. Each layer button shows how many lines it has.

| Layer     | What it draws                                                                       |
| --------- | ----------------------------------------------------------------------------------- |
| Cables    | One line per cable, from each port's `link`. The cables of one LAG are one line.    |
| VLANs     | The VLANs each cable carries. Pick a VLAN in the side panel to light its cables.    |
| Addresses | Address ranges that devices share.                                                  |
| BGP       | Sessions between your devices, matched by address, and sessions to each AS outside. |
| OSPF      | Interfaces in one area and one prefix, where neither side is passive.               |
| Tunnels   | GRE and VXLAN tunnels, matched by their endpoints, and WireGuard peers.             |

To find your way:

- Point at a device to light it and its lines. Click a device or a line to see it in the side panel, with its lines or its two ends. Esc clears the selection.
- Double-click a device to open its page.
- Drag a device to move it. Studio remembers where you put it, per layer, after a reload too.
- Drag the empty space to move the drawing, and scroll to zoom.
- Tab reaches the list of devices, for the keyboard.

Each device shows its front panel, its name, and its platform and model. Dots travel along each line that both ends declare.

| Mark                     | Means                                                                       |
| ------------------------ | --------------------------------------------------------------------------- |
| A dashed line            | Only one end declares it, such as a cable whose far port doesn't link back. |
| A line marked "4 cables" | More than 3 lines between two devices, drawn as one. Click it for the list. |
| A dotted box             | Something outside the network, such as another AS.                          |
| An orange or red frame   | The device has warnings or errors, as `circuit validate` reports them.      |

The buttons above the drawing:

| Button        | What it does                                              |
| ------------- | --------------------------------------------------------- |
| Fit           | Shows the whole layer.                                    |
| Lay out again | Forgets where you moved devices on this layer.            |
| Save image    | Saves the layer as a PNG.                                 |
| Save SVG      | Saves the layer as an SVG, which stays sharp at any size. |

The graph shows what your files say, not what is plugged in. To check the cables, run `circuit diff` on the device: it compares what LLDP sees with each `link`.

### Present on a big screen

**Present**, or the key P, shows the network on a wall screen, such as in a NOC:

1. The drawing fills the window, and the whole screen when the browser allows it.
2. Every 6 seconds it moves on: first the whole layer, then its four busiest devices one by one, each lit with its neighbors and a ring around it.
3. Then it shows the whole layer again, and goes on to the next layer that has lines.

The drawing drifts slowly while it presents. It waits while you point at a device or drag one. **Stop presenting** or Esc stops it. A screen that reloads keeps presenting.

## Look things up

The tabs at the top list everything in your files:

| Tab       | What it lists                                                                                              |
| --------- | ---------------------------------------------------------------------------------------------------------- |
| Devices   | Every device, with its platform, model, site, ports declared and findings. Each opens the device's page.   |
| VLANs     | Every VLAN, its gateways, and the access and trunk ports on each device.                                   |
| Addresses | Each address space with its segments, what is free and the next free address, and every address in use.    |
| BGP       | Every session, what it takes from its group, and what is at the far end.                                   |
| Cables    | Every cable, with the VLANs it carries.                                                                    |
| Problems  | What `circuit validate` finds, and every line only one end declares. The count in the top bar is the same. |

**Search** finds a name, an address or any other value in any device. It shows where each match is and how many there are, up to 200.

Point at a field name with a dotted underline, such as `remote_as`, to see what it means. It is the same text your editor shows.

A secret shows as its name, such as `secret("EDGE_01_PASSWORD")`, never as its value. To see the values, see [Secrets in Studio](/guide/secrets#in-studio).

Every table has **Save as CSV**, for a spreadsheet.

### A device's page

| Tab               | What it shows                                                                                   |
| ----------------- | ----------------------------------------------------------------------------------------------- |
| Overview          | Its platform, model, site and file, and what `circuit validate` found on it.                    |
| Ports             | Its front panel, colored by how each port is used, how many ports are declared, and every port. |
| Interfaces        | Its LAGs, VLAN interfaces, loopbacks and tunnels.                                               |
| Switching         | Its VLANs, spanning tree, LLDP and ACLs.                                                        |
| Routing           | Its static routes, BGP, OSPF, policies and prefix sets.                                         |
| Firewall          | Its filter chains, NAT and address sets.                                                        |
| Services          | Its DHCP, DNS and other services.                                                               |
| Management        | How people and tools log in.                                                                    |
| System            | Its users, time, DNS and logs.                                                                  |
| Monitoring        | SNMP, syslog and flow export.                                                                   |
| Config            | The config Circuit writes, in the vendor's own commands. Secrets show by name.                  |
| On the device now | What the device runs, and what `circuit apply` would send.                                      |
| History           | The commits that changed the device's file.                                                     |

**show in the graph** on a device's Overview lights it on the graph.

**Read from the device now** logs in to the device and reads it, like `circuit diff`. Nothing is sent, and Studio keeps no copy. It needs the device's password, so it works only when the secrets password comes from 1Password, `CIRCUIT_SECRETS_PASSWORD` or a password Circuit remembers. Otherwise run `circuit diff`, which asks for it.

## Review a change

Studio compares your files now with a branch, a tag or a commit. Your project must be in git, which `circuit new` sets up.

1. Open **Compare** in the top bar.
2. Pick a branch, tag or recent commit, or type one, such as `main` or `HEAD~3`.
3. Studio shows what differs:
    - devices added and removed, and each device whose config changes, line by line;
    - lines of the graph added and gone, layer by layer;
    - what `circuit validate` finds now that it didn't before, and what it no longer finds.
4. **Show the changes in the graph** draws new lines in green and removed lines in dashed red. **Stop comparing** goes back to the graph as it is.

Before you merge a pull request, compare its branch with `main`. You see what it changes in the network, not only in the files. Studio reads both sides with the Circuit you run now, so changes to Circuit itself don't show.

A device's **History** tab lists the commits that changed its file, newest first. **compare with now** opens Compare at that commit.
