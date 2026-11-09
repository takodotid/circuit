---
description: Your project in the browser. The network drawn, everything in tables, no TypeScript needed.
---

# Circuit Studio

Studio is your project in the browser: the network drawn, everything in tables, a tracer, a compare view, and your secrets. Great for finding your way around, or looking something up without reading code.

It only reads your files. It touches a device only when you press **Read from the device now**, and then it only reads.

<img class="screenshot light" src="/screenshots/studio-light.png" alt="Studio's graph of cables between edge-01 and tor-01, with the layer tabs above it and the legend beside it.">
<img class="screenshot dark" src="/screenshots/studio-dark.png" alt="Studio's graph of cables between edge-01 and tor-01, with the layer tabs above it and the legend beside it.">

## Starting it

1. `circuit studio` (or **Studio** in the menu).
2. Your browser opens `http://127.0.0.1:4600`.
3. Pick a tab, or search.
4. Save a file, and Studio updates by itself.

Only your machine can reach it. Ctrl+C stops it.

| Option                 | Does                                              |
| ---------------------- | ------------------------------------------------- |
| `--port <number>`      | The port. Default `4600`.                         |
| `--host <address>`     | Where it listens. See [Hosting](/studio/hosting). |
| `--allow-host <names>` | Names people use to reach it, behind a proxy.     |
| `--no-open`            | Don't open the browser.                           |

## What it has

| Tab                         | What it shows                                                                                         |
| --------------------------- | ----------------------------------------------------------------------------------------------------- |
| [Graph](/studio/graph)      | Cables, VLANs, addresses, BGP sessions, OSPF neighbors and tunnels, drawn, with what is wrong marked. |
| [Devices](/studio/tables)   | Every device, with a page for each one.                                                               |
| [VLANs](/studio/tables)     | Every VLAN, the devices that have it, its gateways and the ports that carry it.                       |
| [Addresses](/studio/tables) | Every address in use, and what is free.                                                               |
| [BGP](/studio/tables)       | Every BGP session, and what is at its far end.                                                        |
| [Cables](/studio/tables)    | Every cable, with the VLANs it carries.                                                               |
| [Tools](/studio/tools)      | Trace an address, find a VLAN's path, and test a firewall or a route policy.                          |
| [Compare](/studio/changes)  | Your files now beside another branch, tag or commit: what each device would run differently.          |
| [Secrets](/studio/secrets)  | Every secret, and how it is kept. Its value only after you type the file's password.                  |
| [Problems](/studio/tables)  | What `circuit validate` finds, and what only one end declares. The top bar counts them.               |

Every page has its own address, like `#devices/edge-01`, so back buttons and bookmarks work.
