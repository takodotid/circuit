# Circuit Studio

Circuit Studio is your project in the browser: the network drawn, tables of everything in your files, tools to trace an address, a comparison with any commit, and your secrets. Use it to learn how a network is laid out, or to look something up without reading TypeScript.

It reads your files. It logs in to a device only when you press **Read from the device now** on that device's page, and even then it only reads.

<img class="screenshot light" src="/screenshots/studio-light.png" alt="Studio's graph of cables between edge-01 and tor-01, with the layer tabs above it and the legend beside it.">
<img class="screenshot dark" src="/screenshots/studio-dark.png" alt="Studio's graph of cables between edge-01 and tor-01, with the layer tabs above it and the legend beside it.">

## Starting it

1. Run `circuit studio` in your project, or pick **Studio** in the menu.
2. Your browser opens Studio, at `http://127.0.0.1:4600`.
3. Pick a tab in the top bar, or search for anything in your files.
4. Edit a file and save it. Studio shows the change at once.

Studio answers only on your own machine. Stop it with Ctrl+C.

| Option                 | What it does                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------ |
| `--port <number>`      | The port it listens on. `4600` by default.                                                       |
| `--host <address>`     | The address it listens on. This machine only by default. See [Hosting](/studio/hosting).         |
| `--allow-host <names>` | The names people reach it by, such as `studio.example.com` behind a proxy. It refuses any other. |
| `--no-open`            | Do not open the browser.                                                                         |

## What it has

| Tab                         | What it shows                                                                                         |
| --------------------------- | ----------------------------------------------------------------------------------------------------- |
| [Graph](/studio/graph)      | Cables, VLANs, addresses, BGP sessions, OSPF neighbors and tunnels, drawn, with what is wrong marked. |
| [Devices](/studio/tables)   | Every device, with a page for each one.                                                               |
| [VLANs](/studio/tables)     | Every VLAN, the devices that have it, its gateways and the ports that carry it.                       |
| [Addresses](/studio/tables) | Every address in use, and what is free.                                                               |
| [BGP](/studio/tables)       | Every BGP session, and what is at its far end.                                                        |
| [Cables](/studio/tables)    | Every cable, with the VLANs it carries.                                                               |
| [Tools](/studio/tools)      | Trace an address, and find a VLAN's path.                                                             |
| [Compare](/studio/changes)  | Your files now beside another branch, tag or commit: what each device would run differently.          |
| [Secrets](/studio/secrets)  | Every secret in `.env`, and how it is kept. Its value only after you type the key.                    |
| [Problems](/studio/tables)  | What `circuit validate` finds, and what only one end declares. The top bar counts them.               |

Each page has its own address, such as `http://127.0.0.1:4600/#devices/edge-01`, so the browser's back button works and a bookmark opens the same page.
