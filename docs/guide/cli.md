# CLI commands

Run every command from your project as `npx circuit <command>`, or `pnpm circuit <command>` with pnpm, or `bun circuit <command>` with Bun. It reads `circuit.config.ts` in the current directory, or another file if you give its path with `--config <path>`.

`npx circuit --help` lists every command, and `npx circuit <command> --help` lists what one command takes. An option can come before or after the device names, and an option with a value can be written either way: `--config other.ts` or `--config=other.ts`. A command stops with an error when it is given an option it does not know, or more device names than it takes.

## Every command

| Command                          | What it does                                                                                                                                                                        | Touches a device |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `new [directory]`                | Starts a new project from a pattern. See [Getting started](/guide/getting-started).                                                                                                 | no               |
| `validate`                       | Checks every file and runs your checks                                                                                                                                              | no               |
| `secrets`                        | Lists every secret the files use, and whether each one can be read                                                                                                                  | no               |
| `build <device>`                 | Prints the whole configuration the device should run, in its vendor's commands                                                                                                      | no               |
| `diff [device...]`               | Shows what would change, compared with the last snapshot                                                                                                                            | no               |
| `snapshot [device...]`           | Reads what each device runs now, into `.circuit/state/`                                                                                                                             | reads only       |
| `apply <device>`                 | Reads the device, then shows the plan; with `--confirm`, sends it                                                                                                                   | with `--confirm` |
| `show <device> [command...]`     | Runs commands that only read, such as `/ip route print`, and prints the answers with secrets hidden. See [show](#show-commands-that-only-read).                                     | reads only       |
| `bgp [device] [name-regex]`      | Shows each BGP neighbor in the files next to its live session: up or down, prefixes, uptime. See [bgp](#bgp-neighbors-and-their-sessions).                                          | reads only       |
| `console <device> [line...]`     | Opens the device's serial console in your terminal, logged in; or sends it lines. See [console](#console-a-device-s-serial-console).                                                | what you send    |
| `refresh <device>`               | Fetches prefix lists from a registry; with `--confirm`, puts them on the device                                                                                                     | with `--confirm` |
| `rename <device> <new-name>`     | Gives a device a new name in every file that uses its name; with `--confirm`, writes it. See [Renaming a device](/guide/devices#renaming-a-device).                                 | no               |
| `wireguard <device> <if> <peer>` | Prints a WireGuard client config for one peer                                                                                                                                       | no               |
| `communities`                    | Prints your BGP communities, for a looking glass or bgp.tools                                                                                                                       | no               |
| `peeringdb`                      | Updates your PeeringDB record to match the config; with `--confirm`, sends it                                                                                                       | PeeringDB only   |
| `librenms`                       | Brings LibreNMS in line with the config: devices, their names, credentials and locations, and a group per site; with `--confirm`, sends it. See [LibreNMS](/integrations/librenms). | LibreNMS only    |
| `netbox`                         | Brings NetBox in line with the config; with `--confirm`, sends it. See [NetBox](/integrations/netbox).                                                                              | NetBox only      |
| `prometheus`                     | Prints every device with SNMP as a target for Prometheus. See [Prometheus](/integrations/prometheus).                                                                               | no               |
| `addresses [prefix]`             | Lists every address the files use, by prefix, and what is still free. See [Finding a free address](/guide/addresses).                                                               | no               |
| `graph [device...]`              | Prints the network as a graph: cables, VLANs, addresses, BGP, OSPF or tunnels. See [Printing the graph](/guide/graph).                                                              | no               |
| `studio`                         | Opens Circuit Studio: the network in your browser, drawn and in tables, again each time a file changes. See [Studio](/studio/).                                                     | no               |

`diff` and `snapshot` take device names, or work on every device when you give none.

## snapshot, diff, apply and refresh

These four are easy to mix up:

- **`snapshot`** only reads. It logs in to each device and saves what the device runs in `.circuit/state/`. It changes nothing on any device.
- **`diff`** never logs in. It compares your files with the last snapshot, so it is fast, works offline, and is safe in CI. If someone changed a device by hand after the last snapshot, `diff` does not know.
- **`apply`** always reads the device again first, so its plan is made against what the device runs right now. Without `--confirm` it stops after showing the plan. With `--confirm` it first checks the path to the device (see below), then sends the plan, reads the device once more and saves the new snapshot. Last, it checks the device is healthy, such as that the BGP sessions up before are up again, and fails if not. See [Checking the device afterwards](/guide/convergence#checking-the-device-afterwards).
- **`refresh`** is only for prefix lists that come from a registry, such as every prefix a customer's AS announces. Those lists change on their own, every day, so they are not part of your files or of `apply`. `refresh` fetches the current list and, with `--confirm`, puts it on the device. Run it on a schedule: see [Scheduled refresh](/guide/scheduled-refresh).

### The path check before apply --confirm

A change sent over a path that drops packets can cut the device off halfway, and a lossy path also cuts the read of the device short. So before `apply --confirm` reads or sends anything, Circuit pings the device's management address 20 times, with your system's `ping`, which takes about five seconds:

```
path: 10.0.0.1: 0 of 20 pings lost (0%), 12 ms on average
```

It stops, and sends nothing, when more than 5% of the pings are lost (two of 20) or the average round trip is over 300 ms. Fix the path first: the problem is often on your own side, such as your internet provider or a VPN. To send anyway, add `--force`.

A device that answers no ping at all, because a firewall drops pings, is not stopped for that alone: Circuit says the path was not measured and goes on. With `--console`, or for a device reached only through its console, there is no path to measure and the check is skipped.

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

## bgp: neighbors and their sessions

`bgp` shows each BGP neighbor in the device's file next to its live session on the device, one line each: its name, `up` or `DOWN`, how many prefixes it sent us, how long the session has been up, and the neighbor's address. A neighbor with no session at all is shown as down.

```bash
npx circuit bgp edge-01
npx circuit bgp edge-01 'sgix' --wait          # until every neighbor whose name has sgix is up
npx circuit bgp edge-01 'sgix' --wait=4        # until at least 4 of them are up
npx circuit bgp edge-01 --log=10               # also the BGP log lines of the last 10 minutes
```

```
hurricane-electric  up     987654  1w2d03:04:05  203.0.113.1
sgix-rs-v4          DOWN        -  -             192.0.2.1
sgix-rs-v6          DOWN        -  no session    -
1/3 up
```

1. The device can be left out when only one device in the network has BGP neighbors: `npx circuit bgp sgix`.
2. The second argument is a regular expression. Only the neighbors whose name matches are shown.
3. `--wait` reads again every 15 seconds until every neighbor shown is up, or with `--wait=N`, at least N of them. It gives up after `--max` seconds, 600 by default, and then exits with code 1. Use it after a provider cutover. `apply --confirm` already waits for the sessions that were up before it.
4. `--log` adds the device's BGP log lines of the last few minutes, 5 by default. A message that repeats is folded into one line with its first and last time and a count, such as `2026-10-24 03:01:00..03:04:50 x24`. It shows every BGP line, not only those of the neighbors shown.

`bgp` only reads, and works on RouterOS so far. On another platform it says it does not support it yet and stops before it connects.

On RouterOS:

- A neighbor is matched with its session by address first, then by name. A connection that was renamed keeps its session's old name until the session restarts.
- `--log` leaves out the `connection ...` lines a session that cannot connect repeats. The device's own time filter in `/log print` does not filter, so Circuit keeps the lines of the last minutes itself, by the device's clock.

## console: a device's serial console

`console` opens the device's serial console, `connection.console`, the same one `--console` uses. It is the way in when the management network is down.

```bash
npx circuit console core-01                                   # in your terminal; Ctrl-] leaves
npx circuit console core-01 'display interface brief'         # send lines, print what comes back
npx circuit console fw-01 '@wait=10:execute ping 192.0.2.1'   # wait for 10 quiet seconds after a slow command
npx circuit console fw-01 --raw '' "@if=(Press 'a' to accept):=>a"
```

1. Circuit logs in with the device's own login, the way `--console` does, so you never type a password.
2. With no lines, the console is joined to your terminal. Everything you type goes to the device, Ctrl-C too, to stop a running command. Ctrl-] leaves.
3. With lines, each one is sent in turn, and what the console printed until it went quiet for 1.5 seconds is shown, with every secret replaced by `<redacted>`.
4. Circuit logs out at the end, also when you press Ctrl-C while lines are being sent, or close the terminal, and lets the port go.

A line can start with:

- `@wait=N:` to wait for N seconds of quiet instead of 1.5, for a slow command.
- `@if=TEXT=>` to send the line only when what the console printed last ends with TEXT, for a prompt that may or may not come. Both can be used together, `@if` first.

A console has no exit code. A command it refuses answers with text, so read what it printed: `console` cannot tell whether a line worked. The lines are not checked the way `show` checks commands: a line that changes the device changes it.

`--raw` does not log in or out. Use it to answer a prompt Circuit does not know, such as a boot menu.

Only one program can hold a console port. If another one does, `console` says the port is in use and stops.

## Options

| Option              | For                                                             | What it does                                                                                                                                                       |
| ------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `--config <path>`   | every command                                                   | Read the network from this file instead of `circuit.config.ts`                                                                                                     |
| `--confirm`         | `apply`, `refresh`, `peeringdb`, `librenms`, `netbox`, `rename` | Actually send, or for `rename`, write the files. Without it, nothing is sent or written.                                                                           |
| `--secrets`         | `apply`, `diff`                                                 | Send every secret again, when you change a password. With `diff`, plan as `apply --secrets` would. See [Secrets](/guide/secrets#changing-a-secret).                |
| `--auths`           | `prometheus`                                                    | Print the SNMP exporter's credentials instead of the devices. See [Prometheus](/integrations/prometheus#the-credentials).                                          |
| `--rollback=N`      | `apply`                                                         | On RouterOS, Junos and FortiOS, how many whole minutes the device waits before undoing the change if Circuit cannot log in again. 10 by default.                   |
| `--force`           | `apply`                                                         | Send even when the [path check](#the-path-check-before-apply-confirm) finds too much loss or too slow a path.                                                      |
| `--console`         | `snapshot`, `apply`, `show`                                     | Reach the device through its serial console, on this computer or a jump host, instead of SSH. See [Devices](/guide/devices#reaching-a-device-through-its-console). |
| `--file`            | `rename`, `show`                                                | For `rename`, also rename the file that declares the device, to `<new-name>.ts`. For `show`, also run each line of this file.                                      |
| `--timeout=N`       | `show`                                                          | How many whole seconds each command may take. 90 by default.                                                                                                       |
| `--wait[=N]`        | `bgp`                                                           | Read again until every neighbor shown, or N of them, is up.                                                                                                        |
| `--max=N`           | `bgp`                                                           | How many whole seconds `--wait` waits at most. 600 by default.                                                                                                     |
| `--log[=N]`         | `bgp`                                                           | Also print the device's BGP log lines of the last N minutes. 5 by default.                                                                                         |
| `--raw`             | `console`                                                       | Do not log in or out. Only join the console, or send the lines.                                                                                                    |
| `--length=N`        | `addresses`                                                     | List the free prefixes of this length, instead of the fewest that cover the free space.                                                                            |
| `--layer=L`         | `graph`                                                         | Which layer to print: `l1`, `l2`, `l3`, `bgp`, `ospf` or `tunnels`, several with commas, or `all`. `l1` by default.                                                |
| `--format=F`        | `graph`, `addresses`                                            | For `graph`, `mermaid`, `dot` or `json`, `mermaid` by default. For `addresses`, `json`.                                                                            |
| `--port=N`          | `studio`                                                        | The port Studio listens on. 4600 by default.                                                                                                                       |
| `--no-open`         | `studio`                                                        | Do not open the browser.                                                                                                                                           |
| `--host=ADDRESS`    | `studio`                                                        | Listen on this address, such as `0.0.0.0` on a server, instead of this machine only. Needs `--allow-host`. See [Hosting](/studio/hosting).                         |
| `--allow-host=NAME` | `studio`                                                        | The names Studio is reached by, several with commas. It refuses any other.                                                                                         |
| `--json`            | `studio`                                                        | Print everything Studio shows, as JSON, instead of starting it.                                                                                                    |

## Making a change, step by step

1. Edit the device's file.
2. `npx circuit validate`, and fix every error.
3. `npx circuit diff <device>` to see the change, offline.
4. `npx circuit apply <device>` to see the plan against the live device. Read every line. A line that sets a menu's settings, shown as `~ set`, can turn something off.
5. `npx circuit apply <device> --confirm` to send it.
6. Commit the device's file together with the new snapshot in `.circuit/state/`.
