# Looking things up

Next to the graph, the top bar has tables of everything in your files. You can read a network with them without reading TypeScript.

| View      | What it lists                                                                                                                                                                                                                                                              |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Devices   | Every device. Each has a page per part: ports, including those the config leaves shut; interfaces; VLANs; routing; policies; firewall; users and ways in; DHCP and flow export; the config it would run, as `circuit build` prints it; and what `circuit diff` would send. |
| VLANs     | Every VLAN, the devices that declare it, its gateways, and the ports that carry it.                                                                                                                                                                                        |
| Addresses | Every address in use and what is free, as [`circuit addresses`](/guide/addresses) prints it.                                                                                                                                                                               |
| BGP       | Every session, with its group's settings filled in, and what is at the far end.                                                                                                                                                                                            |
| Cables    | Every cable, with the VLANs it carries.                                                                                                                                                                                                                                    |
| Problems  | Everything that needs a look: what `circuit validate` found, what only one end declares, and devices unlike their last snapshot. The top bar counts them.                                                                                                                  |

**Search** in the top bar finds a name, an address or any other value in any device, and opens the page that shows it.

A column that shows a field, such as `remote_as`, has the field's name as its heading. Point at it to see what the field means: it is the same text your editor shows.

A secret shows as its name, such as `secret("EDGE_01_PASSWORD")`, never as its value. Studio only reads. To change something, edit the device's file, and Studio shows the change when you save it.

## What a device runs

A device's **Running** page shows its last snapshot, what it ran when Circuit last read it, next to what your files say it should run, line by line. Lines can differ only in order or form, so the **Plan** page, what `circuit diff` would send, is the one that says what would change.

## A device's history

A device's **History** page lists the commits that changed it. See [Reviewing changes](/studio/changes).

## A device's ports

A device's **Ports** page starts with its front panel: a square for each port of its model, by speed, colored by how the port is used. A dot marks a port linked to another of your devices. Click a square to find its row in the table below.

## Saving

Each list can be saved for a spreadsheet with **Save as CSV** above it. On the graph, **Save image** saves the layer shown, as it looks, as an SVG or a PNG.
