# CLI commands

Run every command from your project as `npx circuit <command>`, or `pnpm circuit <command>` with pnpm, or `bun circuit <command>` with Bun. It reads `circuit.config.ts` in the current directory, or another file if you give its path with `--config <path>`.

`npx circuit --help` lists every command, and `npx circuit <command> --help` lists what one command takes. An option can come before or after the device names, and an option with a value can be written either way: `--config other.ts` or `--config=other.ts`. A command stops with an error when it is given an option it does not know, or more device names than it takes.

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
| `show <device> [command...]`     | Runs commands that only read, such as `/ip route print`, and prints the answers with secrets hidden. See [show](#show-commands-that-only-read).     | reads only       |
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

## show: commands that only read

`show` is for a quick look at a device: a route, a counter, a neighbor. It logs in the way `snapshot` does, runs each command you give, and prints what the device answered under a line with the command and how long it took.

```bash
npx circuit show edge-01 '/ip route print where dst-address=0.0.0.0/0' '/interface print stats'
npx circuit show edge-01 --file=look.txt
npx circuit show edge-01 '/tool torch interface=sfp28-1 duration=20' --timeout=60
```

A file for `--file` has one command per line. Blank lines and lines that start with `#` are skipped.

Before it connects, `show` checks every command against the list for the device's platform. If one is not on it, `show` stops and sends nothing:

| Platform     | Commands `show` takes                                                                                                                                                                                                                                                                                                                                                                 |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RouterOS     | Commands with `print`, `monitor`, `monitor-traffic`, `ping`, `traceroute`, `torch`, `profile`, `sniffer quick`, `test-as-path-regexp`, `export`, `get` or `find`, and scripts that start with `:put`, `:foreach` or `:delay`. Never with a word that changes something, such as `set`, `add`, `remove`, `run` or `reboot`, nor `show-sensitive` or `file=`.                           |
| VRP          | `display ...`, without a `?`                                                                                                                                                                                                                                                                                                                                                          |
| Raisecom ROS | `show ...`, without a `?`                                                                                                                                                                                                                                                                                                                                                             |
| Junos        | `show ...`                                                                                                                                                                                                                                                                                                                                                                            |
| FortiOS      | `show ...`, `get ...`, `diagnose sys session filter`, `list`, `stat` and `full-stat`, `diagnose sys top`, `diagnose hardware deviceinfo nic`, `diagnose npu np6` `dce`, `synproxy-stats`, `port-list` and `sse-stats`, `diagnose netlink aggregate`, `diagnose debug crashlog read`, and `execute ping`, `ping6`, `traceroute` and `sensor list`. Never `diagnose sys session clear`. |

On VRP and Raisecom, a `?` sent by a script is run as a command, not answered with help, so `show` refuses a line with one.

What `show` prints never holds a secret: every secret Circuit knows, the password it logged in with too, is replaced with `<redacted>`. See [Secrets](/guide/secrets#in-a-tool-of-your-own).

Each command may take `--timeout` seconds, 90 by default:

- On RouterOS and Junos, each command runs on its own. One still running at the limit is left, and what it printed so far is shown.
- VRP and Raisecom take commands only in one shell, so every command runs there. On FortiOS, `diagnose sys session filter` sets the filter only for the shell it runs in, so from the first filter on, the commands run in one shell. In a shell, a command still running at the limit stops the run, since the shell can take nothing else until it ends.
- With `--console`, every command runs on the console, one after the other, as in a shell.

On Git Bash for Windows, set `MSYS_NO_PATHCONV=1` first. Otherwise a command that starts with `/`, as RouterOS commands do, is turned into a Windows path.

## Options

| Option              | For                                                   | What it does                                                                                                                                                       |
| ------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `--config <path>`   | every command                                         | Read the network from this file instead of `circuit.config.ts`                                                                                                     |
| `--confirm`         | `apply`, `refresh`, `peeringdb`, `librenms`, `rename` | Actually send, or for `rename`, write the files. Without it, nothing is sent or written.                                                                           |
| `--secrets`         | `apply`, `diff`                                       | Send every secret again, when you change a password. With `diff`, plan as `apply --secrets` would. See [Secrets](/guide/secrets#changing-a-secret).                |
| `--auths`           | `prometheus`                                          | Print the SNMP exporter's credentials instead of the devices. See [Prometheus](/integrations/prometheus#the-credentials).                                          |
| `--rollback=N`      | `apply`                                               | On RouterOS, Junos and FortiOS, how many whole minutes the device waits before undoing the change if Circuit cannot log in again. 10 by default.                   |
| `--console`         | `snapshot`, `apply`, `show`                           | Reach the device through its serial console, on this computer or a jump host, instead of SSH. See [Devices](/guide/devices#reaching-a-device-through-its-console). |
| `--file`            | `rename`, `show`                                      | For `rename`, also rename the file that declares the device, to `<new-name>.ts`. For `show`, also run each line of this file.                                      |
| `--timeout=N`       | `show`                                                | How many whole seconds each command may take. 90 by default.                                                                                                       |
| `--length=N`        | `addresses`                                           | List the free prefixes of this length, instead of the fewest that cover the free space.                                                                            |
| `--layer=L`         | `graph`                                               | Which layer to print: `l1`, `l2`, `l3`, `bgp`, `ospf` or `tunnels`, several with commas, or `all`. `l1` by default.                                                |
| `--format=F`        | `graph`, `addresses`                                  | For `graph`, `mermaid`, `dot` or `json`, `mermaid` by default. For `addresses`, `json`.                                                                            |
| `--port=N`          | `studio`                                              | The port Studio listens on. 4600 by default.                                                                                                                       |
| `--no-open`         | `studio`                                              | Do not open the browser.                                                                                                                                           |
| `--host=ADDRESS`    | `studio`                                              | Listen on this address, such as `0.0.0.0` on a server, instead of this machine only. Needs `--allow-host`. See [Hosting](/studio/hosting).                         |
| `--allow-host=NAME` | `studio`                                              | The names Studio is reached by, several with commas. It refuses any other.                                                                                         |
| `--json`            | `studio`                                              | Print everything Studio shows, as JSON, instead of starting it.                                                                                                    |

## Making a change, step by step

1. Edit the device's file.
2. `npx circuit validate`, and fix every error.
3. `npx circuit diff <device>` to see the change, offline.
4. `npx circuit apply <device>` to see the plan against the live device. Read every line. A line that sets a menu's settings, shown as `~ set`, can turn something off.
5. `npx circuit apply <device> --confirm` to send it.
6. Commit the device's file together with the new snapshot in `.circuit/state/`.
