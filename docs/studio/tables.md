# Looking things up

Next to the graph, the top bar has tables of everything your files hold. You can read a network with them without reading TypeScript.

| View      | What it lists                                                                                                                                                                                                                                                              |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Devices   | Every device. Each has a page per part: ports, including those the config leaves shut; interfaces; VLANs; routing; policies; firewall; users and ways in; DHCP and flow export; the config it would run, as `circuit build` prints it; and what `circuit diff` would send. |
| VLANs     | Every VLAN, the devices that declare it, its gateways, and the ports that carry it.                                                                                                                                                                                        |
| Addresses | Every address in use and what is free, as [`circuit addresses`](/guide/addresses) prints it.                                                                                                                                                                               |
| BGP       | Every session, with its group's settings filled in, and what is at the far end.                                                                                                                                                                                            |
| Cables    | Every cable, with the VLANs it carries.                                                                                                                                                                                                                                    |
| Problems  | Everything that needs a look: what `circuit validate` found, what only one end declares, and devices unlike their last snapshot. The top bar counts them.                                                                                                                  |

**Search** in the top bar finds a name, an address or any other value in any device, and opens the page that shows it.

A column named after a field, such as `remote_as`, is written as the field is. Point at it to see what the field means: it is the same text your editor shows.

A secret shows as the name its value is read from, such as `secret("EDGE_01_PASSWORD")`, never as the value. Studio only reads. To change something, edit the device's file, and studio shows the change when you save it.

## What a device runs

A device's **Running** page sets its last snapshot, what it ran when Circuit last read it, beside what your files would have it run, line by line. Lines can differ only in order or form, so the **Plan** page, what `circuit diff` would send, is the one that says what would change.
