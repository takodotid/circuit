# The circuit command

Run `circuit` alone, and it opens a menu. Pick what to do, and it asks for what it needs, such as which device. You can also run a command straight away, such as `circuit validate`: the menu and the commands do the same.

<MenuDiagram />

Each command reads the project in the folder you are in, or the nearest folder above it that holds `circuit.ts`. `--project <folder>` reads another one. Leave out the device, and Circuit lists the devices to pick from.

## Core

| Command          | What it does                                                                |
| ---------------- | --------------------------------------------------------------------------- |
| `validate`       | Reads the project and checks it, then runs every check in `circuit.ts`.     |
| `diff [device]`  | Reads the device, and shows what `apply` would change on it. Sends nothing. |
| `apply [device]` | Reads the device, shows what would change, and sends it once you say yes.   |

### Making a change

1. Edit the device's file.
2. `circuit validate`, and fix every error.
3. `circuit apply <device>`. Circuit reads what the device runs now and prints every command it would send, in the vendor's own language.
4. Read every line. Then answer the question:

    ```
    ◆ Send these changes to edge-01?
    │ ○ Yes / ● No
    ```

    The answer is **No** unless you choose **Yes**, so a stray Enter sends nothing. `--confirm` sends without asking, for a script.

5. Commit the file.

`diff` is step 3 without the question. Both read the live device every time: there is no saved copy that can be out of date. While they are connected, they also compare what the device sees over LLDP with each port's `link`, and warn where the cable is not where the file says.

### The path check

A change sent over a path that drops packets can cut the device off halfway. So before `apply` reads the device, Circuit pings its management address 20 times, about five seconds:

```
path: 10.0.0.1: 0 of 20 pings lost (0%), 12 ms on average
```

It stops, and sends nothing, when more than 5% of the pings are lost or the average is over 300 ms. Fix the path first: the problem is often your own side, such as a VPN. `--force` sends anyway. A device that answers no ping at all is not stopped for that: Circuit says the path was not measured and goes on.

### Options

| Option         | For                     | What it does                                                                                                                  |
| -------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `--confirm`    | `apply`                 | Send without asking.                                                                                                          |
| `--secrets`    | `apply`, `diff`         | Send every secret again, to change a password. A device never shows its passwords, so Circuit can't see a change.             |
| `--rollback N` | `apply`                 | On RouterOS, Junos and FortiOS, the minutes before the device undoes the change if Circuit can't log in again. 10 by default. |
| `--force`      | `apply`                 | Send even when the path check fails.                                                                                          |
| `--console`    | `apply`, `diff`, `exec` | Reach the device through its serial console on a jump host, instead of SSH.                                                   |

## Utilities

| Command                             | What it does                                                                                                    |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `exec [device] [command...]`        | Runs commands that only read on the device, and prints the answer. Also `execute`.                              |
| `bgp [device]`                      | Each BGP neighbor next to its live session: up or down and why, prefixes, uptime.                               |
| `access-console [device] [line...]` | Opens the device's serial console, logged in, or sends it lines.                                                |
| `studio`                            | Opens [Circuit Studio](/studio/): the project in your browser. `--port`, `--host`, `--allow-host`, `--no-open`. |
| `rename [device] [new-name]`        | Gives a device a new name everywhere the project writes it, and its file too.                                   |

### exec: commands that only read

```sh
circuit exec edge-01 '/ip route print where dst-address=0.0.0.0/0' '/interface print stats'
circuit exec edge-01 --file look.txt
circuit exec edge-01 '/tool torch interface=sfp28-1 duration=20' --timeout 60
```

Before it connects, `exec` checks every command. A command not known to only read is refused, and nothing is sent: a change goes through `apply`.

| Platform     | Commands `exec` takes                                                                                                                                        |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| RouterOS     | `print`, `monitor`, `monitor-traffic`, `ping`, `traceroute`, `torch`, `export`, `get`, `find` and the like. Never `set`, `add`, `remove`, `run` or `reboot`. |
| VRP          | `display ...`, without a `?`                                                                                                                                 |
| Raisecom ROS | `show ...`, without a `?`                                                                                                                                    |
| Junos        | `show ...`                                                                                                                                                   |
| FortiOS      | `show ...`, `get ...`, and some `diagnose` and `execute` commands that only read, such as `execute ping`.                                                    |

What it prints never holds a secret: each one Circuit knows is replaced with `<redacted>`. Each command may take `--timeout` seconds, 90 by default. A file for `--file` has one command per line; blank lines and lines starting with `#` are skipped.

On Git Bash for Windows, set `MSYS_NO_PATHCONV=1` first, or a command starting with `/`, as RouterOS commands do, is turned into a Windows path.

### bgp: sessions

```sh
circuit bgp edge-01
circuit bgp edge-01 --neighbors transit --wait     # until every neighbor whose name has "transit" is up
circuit bgp edge-01 --log 10                       # also the BGP log lines of the last 10 minutes
circuit bgp edge-01 --neighbors exchange --clear-limit
```

```
transit-a          up     987654  1w2d03:04:05  203.0.113.1
exchange-a-rs-v4   DOWN        0  -             192.0.2.1  limit exceeded: over 100000 prefixes
2/3 up
```

- `--neighbors` takes a regular expression.
- `--wait` reads again every 15 seconds until every neighbor shown is up, or `--wait 4` until 4 are. It gives up after `--max` seconds.
- `--clear-limit` opens again each neighbor shown that closed on its prefix limit. When several close on their limit at once, Circuit says so: that is usually a leak upstream, not growth.
- `bgp` works on RouterOS so far.

### access-console: the serial console

The way in when the management network is down. Circuit logs in with the device's own user, so you never type a password.

```sh
circuit access-console core-01                              # in your terminal; Ctrl-] leaves
circuit access-console core-01 'display interface brief'    # send lines, print what comes back
```

- A line can start with `@wait=N:` to wait N quiet seconds after a slow command, or `@if=TEXT=>` to send it only when the console's last output ends with TEXT.
- `--raw` doesn't log in or out, for a prompt Circuit doesn't know, such as a boot menu.
- Lines are not checked the way `exec` checks commands: a line that changes the device changes it.

### rename

```sh
circuit rename edge-01 edge-02
```

1. Circuit finds every text in the project's files that is exactly the old name, in quotes: the device's `name`, each `link` to it, each part keyed by it, a BGP neighbor named after it. It shows each line that changes, before and after.
2. When the device's file is named after it, such as `edge-01.ts`, it asks whether to rename the file too, yes by default. `--file` or `--no-file` answers for you. Every import of the file changes to match.
3. It lists the lines that only mention the name inside longer text, such as a description or a comment, and leaves them alone. Change those by hand if you want.
4. It writes once you say yes. The default is no. `--confirm` writes without asking.

Then `circuit diff edge-02` and `circuit apply edge-02`, so the device takes its new hostname. A BGP neighbor that was renamed restarts its session: the plan shows it.

## Secrets

`circuit env` lists, sets and rotates the project's secrets. See [Secrets](/guide/secrets).

## Updates

`circuit update` installs the newest Circuit. Before each command, Circuit checks once a minute whether a newer one is out:

- **Newer:** a warning, and the command runs.
- **Critical:** a release that fixes something serious stops every older Circuit. Only `circuit update` runs.
- **Offline:** a warning that Circuit couldn't check. Go carefully.
