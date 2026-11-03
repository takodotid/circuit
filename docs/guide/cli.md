---
description: Every circuit command, the menu, and how a change gets to a device.
---

# The circuit command

Type `circuit` and you get a menu. Pick what you want, and it asks for the rest, like which device.

Know the command already? Run it straight away, like `circuit validate`. Same thing.

<MenuDiagram />

Circuit works on the project in your current folder, or the nearest folder above it with a `circuit.ts`. Use `--project <folder>` for another one. Leave out the device and Circuit lets you pick it from a list.

## Core

| Command          | Does                                                         |
| ---------------- | ------------------------------------------------------------ |
| `validate`       | Checks the whole project. Touches no device.                 |
| `diff [device]`  | Reads the device and shows what would change. Sends nothing. |
| `apply [device]` | Same as `diff`, then sends it once you say yes.              |

### Making a change

1. Edit the device's file.
2. Run `circuit validate`. Fix every error.
3. Run `circuit apply <device>`. Circuit reads the device and prints every command it would send, in the vendor's own language.
4. Read it. Then answer:

    ```
    ◆ Send these changes to edge-01?
    │ ○ Yes / ● No
    ```

    **No** is the default, so a stray Enter sends nothing. `--confirm` skips the question, for scripts.

5. Commit the file.

`diff` and `apply` always read the live device, so what you see is never out of date. While connected, they also check LLDP: if a cable isn't where `link` says, you get a warning.

### The path check

A change sent over a bad link can cut the device off halfway. So `apply` first pings the device 20 times (about 5 seconds):

```
path: 10.0.0.1: 0 of 20 pings lost (0%), 12 ms on average
```

More than 5% lost, or slower than 300 ms on average? It stops. Often it's your own side, like a VPN. `--force` sends anyway. A device that doesn't answer ping at all isn't blocked.

### Options

| Option           | For                         | Does                                                                                                                                                                                                            |
| ---------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--confirm`      | `apply`                     | Sends without asking.                                                                                                                                                                                           |
| `--secrets`      | `apply`, `diff`             | Sends every secret again. Use it to change a password: devices never show passwords.                                                                                                                            |
| `--rollback N`   | `apply`                     | RouterOS, Junos, FortiOS: minutes before the device undoes the change if Circuit can't log back in. Default 10.                                                                                                 |
| `--force`        | `apply`                     | Sends even when the path check fails.                                                                                                                                                                           |
| `--console`      | `apply`, `diff`, `exec`     | Goes through the serial console on a jump host instead of SSH.                                                                                                                                                  |
| `--experimental` | `validate`, `diff`, `apply` | Lets through a field that's built but not proved on a device yet (🧪 in the [feature matrix](/platforms/features)), as a warning. Test it yourself. Not built yet (❌) still stops. The commit hook only warns. |

## Utilities

| Command                             | Does                                                          |
| ----------------------------------- | ------------------------------------------------------------- |
| `exec [device] [command...]`        | Runs read-only commands on the device. Also `execute`.        |
| `bgp [device]`                      | Each BGP neighbor next to its live session. RouterOS for now. |
| `access-console [device] [line...]` | Opens the serial console, already logged in.                  |
| `studio`                            | Opens [Circuit Studio](/studio/) in your browser.             |
| `rename [device] [new-name]`        | Renames a device everywhere in the project.                   |
| `fmt [file...]`                     | Tidies spacing and line breaks. Nothing else changes.         |

### exec

```sh
circuit exec edge-01 '/ip route print where dst-address=0.0.0.0/0'
circuit exec edge-01 --file look.txt
```

Every command is checked before Circuit connects. Anything that could change the device is refused: changes go through `apply`.

| Platform     | Allowed                                                                          |
| ------------ | -------------------------------------------------------------------------------- |
| RouterOS     | `print`, `monitor`, `ping`, `traceroute`, `torch`, `export` and the like         |
| VRP          | `display ...`                                                                    |
| Raisecom ROS | `show ...`                                                                       |
| Junos        | `show ...`                                                                       |
| FortiOS      | `show ...`, `get ...`, and read-only `diagnose` / `execute`, like `execute ping` |

- Secrets in the output show as `<redacted>`.
- Each command gets `--timeout` seconds, 90 by default.
- Git Bash on Windows: set `MSYS_NO_PATHCONV=1` first, or `/ip ...` turns into a Windows path.

### bgp

```sh
circuit bgp edge-01
circuit bgp edge-01 --neighbors hurricane --wait   # wait until it's up
circuit bgp edge-01 --log 10                       # plus 10 minutes of BGP log
```

```
hurricane-electric  up      987654  1w2d03:04:05  203.0.113.1
de-cix-rs-v4        DOWN         0  -             192.0.2.1  limit exceeded: over 100000 prefixes
1/2 up
```

- `--neighbors` takes a regex.
- `--wait` checks every 15 s until they're up (`--max` seconds at most).
- `--clear-limit` reopens sessions that closed on their prefix limit. Several closing at once usually means a leak upstream, so look first.

### access-console

Your way in when the management network is down. Circuit logs in for you.

```sh
circuit access-console core-01                            # interactive, Ctrl-] to leave
circuit access-console core-01 'display interface brief'  # send a line, print the answer
```

- `@wait=N:` before a line waits N quiet seconds; `@if=TEXT=>` sends it only if the last output ends with TEXT.
- `--raw` skips login, for a boot menu and the like.
- Lines aren't checked like `exec`. A line that changes the device changes it.

### rename

```sh
circuit rename edge-01 edge-02
```

1. Shows every line that has exactly `"edge-01"`: its `name`, links to it, parts keyed by it.
2. Asks whether to rename `edge-01.ts` too (yes by default). Imports follow.
3. Lists lines that only mention it inside other text, like a description. Those are yours to change.
4. Writes once you say yes.

Then `circuit apply edge-02`, so the device gets its new hostname.

### fmt

```sh
circuit fmt              # every .ts file of the project
circuit fmt --check      # only says which files need tidying, for CI
```

Tidies the spacing, indents and line breaks of the `.ts` files. What the files say stays the same: nothing is deleted. The style is in the project's `.editorconfig`, and it's the same tidy-up VS Code does each time you save. Use it in another editor or in CI.

## Secrets

`circuit secrets` opens every secret, decrypted, in a text editor in the terminal. Ctrl+S saves them encrypted, Esc leaves. `list`, `get`, `set`, `delete`, `encrypt` and `password` do one thing each. `circuit secrets encrypt` encrypts only values in plain text: encrypted ones and `op://` references stay as they are. See [Secrets](/guide/secrets).

## Projects and the app

| Command             | Does                                                                                                  |
| ------------------- | ----------------------------------------------------------------------------------------------------- |
| `circuit new`       | Starts a project. See [Start a project](/guide/install#start-a-project).                              |
| `circuit update`    | In a project: moves it to the newest version, after a yes. Outside, or with `--app`: updates the app. |
| `circuit uninstall` | Removes the app. Asks first. Never touches your projects.                                             |

Each project runs the version in its `.circuit/version`. See [Install](/guide/install#each-project-pins-its-version).
