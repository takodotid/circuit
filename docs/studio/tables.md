# Looking things up

Beside the graph, the top bar has tables of everything in your files. You can read a network with them without reading TypeScript.

| Tab       | What it lists                                                                           |
| --------- | --------------------------------------------------------------------------------------- |
| Devices   | Every device, with its platform, model and site. Each opens the device's page.          |
| VLANs     | Every VLAN, the devices that have it, its gateways, and the ports that carry it.        |
| Addresses | Every address in use, and what is free.                                                 |
| BGP       | Every session, with what it takes from its group, and what is at the far end.           |
| Cables    | Every cable, with the VLANs it carries.                                                 |
| Problems  | What `circuit validate` found, and what only one end declares. The top bar counts them. |

**Search** in the top bar finds a name, an address or any other value in any device, and opens the page that shows it.

A secret shows as its name, such as `secret("EDGE_01_PASSWORD")`, never as its value. Studio only reads. To change something, edit the file, and Studio shows the change when you save it.

## A device's page

A device's page, such as `#devices/edge-01`, has a tab for each part of it:

| Tab               | What it shows                                                                                                     |
| ----------------- | ----------------------------------------------------------------------------------------------------------------- |
| Overview          | Its platform, model, site and file, and what `circuit validate` found on it.                                      |
| Ports             | Its front panel, a square for each port of its model, colored by how the port is used, and a table of every port. |
| Interfaces        | Its LAGs, VLAN interfaces, loopbacks and tunnels.                                                                 |
| Switching         | Its VLANs, spanning tree, LLDP and ACLs.                                                                          |
| Routing           | Its static routes, BGP, OSPF, policies and prefix sets.                                                           |
| Firewall          | Its filter chains, NAT and address sets.                                                                          |
| Management        | How people and tools log in.                                                                                      |
| System            | Its users, time, DNS and logs.                                                                                    |
| Config            | The configuration Circuit would send, in the vendor's own commands.                                               |
| On the device now | What the device runs, read when you press **Read from the device now**, and what `apply` would send.              |
| History           | The commits that changed the device's file. See [Reviewing changes](/studio/changes).                             |

Studio keeps no copy of what a device runs. **Read from the device now** logs in, reads it, and shows it beside your files with the plan `circuit diff` would print. It only reads: nothing is sent. It needs the device's password, so it works when the secrets password comes from 1Password or `CIRCUIT_SECRETS_PASSWORD`. Otherwise run `circuit diff`, which asks for it.

## Saving

Each table can be saved for a spreadsheet with **Save as CSV** above it. On the graph, **Save image** saves the layer shown as a PNG.
