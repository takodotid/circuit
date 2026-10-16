# CLI commands

Run every command from your project as `npx circuit <command>`, or `pnpm circuit <command>` with pnpm, or `bun circuit <command>` with Bun. It reads `circuit.config.ts` in the current directory, or another file if you give its path with `--config <path>`.

## Every command

| Command                          | What it does                                                                                                                                        | Touches a device |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `new [directory]`                | Starts a new project from a pattern. See [Getting started](/guide/getting-started).                                                                 | no               |
| `validate`                       | Checks every file and runs your checks                                                                                                              | no               |
| `secrets`                        | Lists every secret the files use, and whether each one can be read                                                                                  | no               |
| `build <device>`                 | Prints the whole configuration the device should run, in its vendor's commands                                                                      | no               |
| `diff [device...]`               | Shows what would change, compared with the last snapshot                                                                                            | no               |
| `snapshot [device...]`           | Reads what each device runs now, into `.circuit/state/`                                                                                             | reads only       |
| `apply <device>`                 | Reads the device, then shows the plan; with `--confirm`, sends it                                                                                   | with `--confirm` |
| `refresh <device>`               | Fetches prefix lists from a registry; with `--confirm`, puts them on the device                                                                     | with `--confirm` |
| `rename <device> <new-name>`     | Gives a device a new name in every file that uses its name; with `--confirm`, writes it. See [Renaming a device](/guide/devices#renaming-a-device). | no               |
| `wireguard <device> <if> <peer>` | Prints a WireGuard client config for one peer                                                                                                       | no               |
| `communities`                    | Prints your BGP communities, for a looking glass or bgp.tools                                                                                       | no               |
| `peeringdb`                      | Updates your PeeringDB record to match the config; with `--confirm`, sends it                                                                       | PeeringDB only   |
| `librenms`                       | Adds every device LibreNMS does not monitor yet; with `--confirm`, sends it. See [LibreNMS](/integrations/librenms).                                | LibreNMS only    |
| `prometheus`                     | Prints every device with SNMP as a target for Prometheus. See [Prometheus](/integrations/prometheus).                                               | no               |
| `addresses [prefix]`             | Lists every address the files use, by prefix, and what is still free. See [Finding a free address](/guide/addresses).                               | no               |
| `graph [device...]`              | Prints the network as a graph: cables, VLANs, addresses, BGP, OSPF or tunnels. See [Printing the graph](/guide/graph).                              | no               |
| `studio`                         | Opens Circuit Studio: the network in your browser, drawn and in tables, again each time a file changes. See [Studio](/studio/).                     | no               |

`diff` and `snapshot` take device names, or work on every device when you give none.

## snapshot, diff, apply and refresh

These four are easy to mix up:

- **`snapshot`** only reads. It logs in to each device and saves what the device runs in `.circuit/state/`. It changes nothing on any device.
- **`diff`** never logs in. It compares your files with the last snapshot, so it is fast, works offline, and is safe in CI. If someone changed a device by hand after the last snapshot, `diff` does not know.
- **`apply`** always reads the device again first, so its plan is made against what the device runs right now. Without `--confirm` it stops after showing the plan. With `--confirm` it sends the plan, then reads the device once more and saves the new snapshot.
- **`refresh`** is only for prefix lists that come from a registry, such as every prefix a customer's AS announces. Those lists change on their own, every day, so they are not part of your files or of `apply`. `refresh` fetches the current list and, with `--confirm`, puts it on the device. Run it on a schedule: see [Scheduled refresh](/guide/scheduled-refresh).

## Options

| Option              | For                                                   | What it does                                                                                                                                     |
| ------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `--config <path>`   | every command                                         | Read the network from this file instead of `circuit.config.ts`                                                                                   |
| `--confirm`         | `apply`, `refresh`, `peeringdb`, `librenms`, `rename` | Actually send, or for `rename`, write the files. Without it, nothing is sent or written.                                                         |
| `--secrets`         | `apply`                                               | Send every secret again, when you change a password. See [Secrets](/guide/secrets#changing-a-secret).                                            |
| `--auths`           | `prometheus`                                          | Print the SNMP exporter's credentials instead of the devices. See [Prometheus](/integrations/prometheus#the-credentials).                        |
| `--rollback=N`      | `apply`                                               | On RouterOS, Junos and FortiOS, how many minutes the device waits before undoing the change if Circuit cannot log in again. 10 by default.       |
| `--console`         | `snapshot`, `apply`                                   | Reach the device through its serial console on a jump host, instead of SSH. See [Devices](/guide/devices#reaching-a-device-through-its-console). |
| `--file`            | `rename`                                              | Also rename the file that declares the device, to `<new-name>.ts`.                                                                               |
| `--length=N`        | `addresses`                                           | List the free prefixes of this length, instead of the fewest that cover the free space.                                                          |
| `--layer=L`         | `graph`                                               | Which layer to print: `l1`, `l2`, `l3`, `bgp`, `ospf` or `tunnels`, several with commas, or `all`. `l1` by default.                              |
| `--format=F`        | `graph`, `addresses`                                  | For `graph`, `mermaid`, `dot` or `json`, `mermaid` by default. For `addresses`, `json`.                                                          |
| `--port=N`          | `studio`                                              | The port Studio listens on. 4600 by default.                                                                                                     |
| `--no-open`         | `studio`                                              | Do not open the browser.                                                                                                                         |
| `--host=ADDRESS`    | `studio`                                              | Listen on this address, such as `0.0.0.0` on a server, instead of this machine only. Needs `--allow-host`. See [Hosting](/studio/hosting).       |
| `--allow-host=NAME` | `studio`                                              | The names Studio is reached by, several with commas. It refuses any other.                                                                       |
| `--json`            | `studio`                                              | Print everything Studio shows, as JSON, instead of starting it.                                                                                  |

## Making a change, step by step

1. Edit the device's file.
2. `npx circuit validate`, and fix every error.
3. `npx circuit diff <device>` to see the change, offline.
4. `npx circuit apply <device>` to see the plan against the live device. Read every line. A line that sets a menu's settings, shown as `~ set`, can turn something off.
5. `npx circuit apply <device> --confirm` to send it.
6. Commit the device's file together with the new snapshot in `.circuit/state/`.
