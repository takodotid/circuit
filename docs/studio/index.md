# Studio

Studio is Circuit in your browser: a drawing of your network, and tables of everything your files hold. Use it to learn how a network is laid out, to look something up without reading TypeScript, or to find out why something does not reach where it should.

It reads only your files and the last [snapshot](/guide/glossary#circuit), and never logs in to a device, so it is safe to run at any time.

<img class="screenshot light" src="/screenshots/studio-device-light.png" alt="A device's page in studio, listing every port of its model: the ones the config declares with their VLANs, addresses, LAG and the device at the other end, and the rest as shut down.">
<img class="screenshot dark" src="/screenshots/studio-device-dark.png" alt="A device's page in studio, listing every port of its model: the ones the config declares with their VLANs, addresses, LAG and the device at the other end, and the rest as shut down.">

## Starting it

1. Run `npx circuit studio` in your project.
2. Your browser opens studio, at `http://127.0.0.1:4600`.
3. Pick a view in the top bar, or search for anything in your files.
4. Edit a device's file and save it. Studio shows the change within a second.

Studio answers only on your own machine: nobody else on the network can open it. Stop it with Ctrl+C. To use another port, run `npx circuit studio --port=5000`. To stop it opening the browser, add `--no-open`. To run it on a server for your whole team, see [Hosting](/studio/hosting).

## What it has

| View                        | What it shows                                                                                                                    |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| [Graph](/studio/graph)      | Cables, VLANs, addresses, BGP sessions, OSPF neighbors and tunnels, drawn, with what is broken marked.                           |
| [Devices](/studio/tables)   | Every device, with a page for each part of it.                                                                                   |
| [VLANs](/studio/tables)     | Every VLAN, where it is declared, its gateways and the ports that carry it.                                                      |
| [Addresses](/studio/tables) | Every address in use, and what is free.                                                                                          |
| [BGP](/studio/tables)       | Every BGP session, and what is at its far end.                                                                                   |
| [Cables](/studio/tables)    | Every cable, with the VLANs it carries.                                                                                          |
| [Problems](/studio/tables)  | Everything that needs a look, counted in the top bar.                                                                            |
| [Tools](/studio/tools)      | Trace an address, find a VLAN's path, and test a packet against a firewall or a route against a route policy.                    |
| [Compare](/studio/changes)  | Your files now beside another branch, tag or commit: what each device would run differently, and what the graph gains and loses. |

Each page has its own address, such as `http://127.0.0.1:4600/#devices/edge-01/ports`, so the browser's back button works and a bookmark opens the same page. `npx circuit studio --json` prints everything studio shows as JSON, for a script.
