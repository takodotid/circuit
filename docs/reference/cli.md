---
description: Every circuit command and its options.
---

# The `circuit` command

Run `circuit` alone for a menu, or run a command straight away, such as `circuit validate`. If you leave out an argument, such as the device, Circuit asks for it.

<MenuDiagram />

- Circuit works on the project in the current folder, or in the nearest parent folder that has a `circuit.ts`.
- `circuit <command> --help` lists a command's options.
- Without a terminal, Circuit asks nothing. See [Run in CI](/guide/ci).

## Core

| Command          | Does                                                                                            |
| ---------------- | ----------------------------------------------------------------------------------------------- |
| `validate`       | Checks the whole project. Touches no device.                                                    |
| `diff [device]`  | Reads the device and shows what would change. Sends nothing. Exits 1 if something would change. |
| `apply [device]` | Shows the same plan, then sends it once you say yes. See [Make a change](/guide/apply).         |

| Option                 | For                         | Does                                                                                                                                                                                                                              |
| ---------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--confirm`            | `apply`                     | Sends without asking.                                                                                                                                                                                                             |
| `--secrets`            | `apply`, `diff`             | Sends every secret again. Use it to change a password, because devices never show passwords.                                                                                                                                      |
| `--rollback <minutes>` | `apply`                     | RouterOS, Junos, and FortiOS: how long before the device undoes the change if Circuit can't log back in. Default 10.                                                                                                              |
| `--force`              | `apply`                     | Sends even when the [path check](/guide/apply#the-path-check) fails.                                                                                                                                                              |
| `--console`            | `apply`, `diff`             | Goes through the serial console on a jump host instead of SSH.                                                                                                                                                                    |
| `--experimental`       | `validate`, `diff`, `apply` | Lets a field marked 🧪 in the [feature matrix](/reference/platforms#feature-matrix) through, as a warning. Test it yourself. With `apply`, also runs [the checks afterwards](/guide/apply#checking-afterwards) where they are 🧪. |

## Utilities

| Command                             | Does                                                                           |
| ----------------------------------- | ------------------------------------------------------------------------------ |
| `exec [device] [command...]`        | Runs read-only commands on the device. Also `execute`.                         |
| `bgp [device]`                      | Shows each BGP neighbor next to its live session.                              |
| `access-console [device] [line...]` | Opens the device's serial console, already logged in.                          |
| `communities [network]`             | Prints what each BGP community means, for a looking glass.                     |
| `addresses [prefix]`                | Shows what address space is used, and what is free.                            |
| `sync [target]`                     | Updates NetBox, LibreNMS, PeeringDB, or Prometheus to match the project.       |
| `studio`                            | Opens Circuit Studio in your browser. For its options, see [Studio](/studio/). |
| `rename [device] [new-name]`        | Renames a device everywhere in the project.                                    |
| `fmt [file...]`                     | Tidies spacing and line breaks. Nothing else changes.                          |

### `exec`

```sh
circuit exec edge-01 '/ip route print where dst-address=0.0.0.0/0'
circuit exec edge-01 --file look.txt
```

Circuit refuses any command that could change the device, before it connects.

| Platform     | Allowed                                                                          |
| ------------ | -------------------------------------------------------------------------------- |
| RouterOS     | `print`, `monitor`, `ping`, `traceroute`, `torch`, `export`, and the like        |
| VRP          | `display ...`                                                                    |
| Raisecom ROS | `show ...`                                                                       |
| Junos        | `show ...`                                                                       |
| FortiOS      | `show ...`, `get ...`, and read-only `diagnose` / `execute`, like `execute ping` |

| Option                | Does                                                                                     |
| --------------------- | ---------------------------------------------------------------------------------------- |
| `--file <path>`       | Also runs each line of this file. Blank lines and lines that start with `#` are skipped. |
| `--timeout <seconds>` | How long each command may take. Default 90.                                              |
| `--console`           | Goes through the serial console on a jump host instead of SSH.                           |

Secrets in the output show as `<redacted>`. In Git Bash on Windows, set `MSYS_NO_PATHCONV=1` first, or `/ip ...` turns into a Windows path.

### `bgp`

On RouterOS. On Junos and FortiOS it is 🧪: add `--experimental`, and compare what it shows with the device.

```sh
circuit bgp edge-01
circuit bgp edge-01 --neighbors hurricane --wait   # wait until it's up
circuit bgp edge-01 --log 10                       # plus 10 minutes of BGP log
```

```
┌────────────────────┬───────┬──────────┬──────────────┬─────────────┬──────────────────────────────────────┐
│ Neighbor           │ State │ Prefixes │ Uptime       │ Remote      │ Why                                  │
├────────────────────┼───────┼──────────┼──────────────┼─────────────┼──────────────────────────────────────┤
│ hurricane-electric │ up    │   987654 │ 1w2d03:04:05 │ 203.0.113.1 │                                      │
│ de-cix-rs-v4       │ DOWN  │        0 │ -            │ 192.0.2.1   │ limit exceeded: over 100000 prefixes │
└────────────────────┴───────┴──────────┴──────────────┴─────────────┴──────────────────────────────────────┘
1/2 up
```

| Option                | Does                                                                                                                             |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `--neighbors <regex>` | Shows only the neighbors whose name matches this regular expression.                                                             |
| `--wait [count]`      | Reads again every 15 seconds until every neighbor shown is up, or `count` of them. Exits 1 if time runs out.                     |
| `--max <seconds>`     | How long `--wait` waits at most. Default 600.                                                                                    |
| `--log [minutes]`     | Also prints the device's BGP log of the last minutes. Default 5. RouterOS only.                                                  |
| `--clear-limit`       | Clears the sessions that closed on their prefix limit. If several closed at once, look for a leak upstream first. RouterOS only. |
| `--experimental`      | Reads a platform where `circuit bgp` is 🧪 in the [feature matrix](/reference/platforms#feature-matrix).                         |

### `access-console`

```sh
circuit access-console core-01                            # interactive, Ctrl-] to leave
circuit access-console core-01 'display interface brief'  # send a line, print the answer
```

- `@wait=N:` before a line waits for N quiet seconds. `@if=TEXT=>` sends the line only if the last output ends with TEXT.
- `--raw` skips the login, such as for a boot menu.
- Circuit doesn't check these lines as `exec` does, so a line can change the device.

### `communities`

```sh
circuit communities                 # NLNOG's community,description lines
circuit communities --format alice  # Alice-LG's [bgp_communities] section
circuit communities --format json   # the IETF YANG model's JSON
circuit communities > as64500.txt   # into a file
```

If several networks have [communities](/guide/communities), give the network.

| Format  | For                                                                                                                                                                  |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `nlnog` | The NLNOG Looking Glass's `communities/asNNN.txt`, which bgp.tools reads too. `nnn` is any number, and `$0` is what it matched.                                      |
| `alice` | The `[bgp_communities]` section of an Alice-LG config. `*` is any number, and `$2` is the third part.                                                                |
| `json`  | [draft-ietf-grow-yang-bgp-communities](https://datatracker.ietf.org/doc/draft-ietf-grow-yang-bgp-communities/), which the NLNOG Looking Glass also reads from a URL. |

### `addresses`

```sh
circuit addresses                   # the space your networks own, what uses it, and what is free
circuit addresses 198.51.100.0/24   # only inside this prefix
circuit addresses --length 29       # the free /29s instead
circuit addresses --format json     # for a script
```

Your space is each prefix in `circuit({ prefixes })` and in a device's `originated_prefixes`. Addresses used outside your space come last.

```
198.51.100.0/24, prefixes ours.v4 in circuit.ts, originated by edge-01
  198.51.100.8/29, 5 free, next 198.51.100.10
      198.51.100.9  edge-01 netflix-internet
  198.51.100.64/27, 4 free, next 198.51.100.66
      198.51.100.65  edge-01 shared
      198.51.100.70-198.51.100.94  DHCP pool shared on edge-01
  free: 198.51.100.0/29, 198.51.100.16/28, 198.51.100.32/27, 198.51.100.96/27, 198.51.100.128/25
```

It reads only the project, so it doesn't know addresses a device gave out, such as DHCP leases.

### `sync`

```sh
circuit sync netbox               # shows what would change in NetBox, then asks
circuit sync librenms --confirm   # sends without asking
```

The target is `netbox`, `librenms`, `peeringdb`, or `prometheus`. See [How sync works](/integrations/).

### `rename`

```sh
circuit rename edge-01 edge-02
```

1. Circuit shows every line that has exactly `"edge-01"`, such as its `name` and links to it.
2. It asks whether to rename `edge-01.ts` too. Yes is the default, and imports follow.
3. It lists lines that mention `edge-01` inside other text, such as a description. Those are yours to change.
4. It writes the changes once you say yes.

| Option      | Does                            |
| ----------- | ------------------------------- |
| `--file`    | Renames the device's file too.  |
| `--no-file` | Keeps the file's name as it is. |
| `--confirm` | Writes without asking.          |

Then run `circuit apply edge-02`, so the device gets its new hostname.

### `fmt`

```sh
circuit fmt              # every .ts file of the project
circuit fmt --check      # changes nothing, and fails if a file needs tidying
```

Both `circuit fmt` and VS Code's Prettier extension read the style from `.editorconfig`: 4 spaces, lines up to 140 characters, LF line endings. A `.prettierrc.json`, if you add one, goes on top.

## Secrets

Each `secrets` command works on `.circuit/secrets`, or on another file with `--file <path>`. See [Secrets](/guide/secrets).

| Command                      | Does                                                                                                                                     |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `secrets`                    | In a terminal, the same as `secrets edit`. Without one, the same as `secrets list`.                                                      |
| `secrets edit`               | Opens every secret, decrypted, in a text editor in the terminal.                                                                         |
| `secrets list`               | Lists every secret and how it is stored, and the ones the config needs but the file lacks. Shows no values.                              |
| `secrets get [name]`         | Prints one secret, decrypted.                                                                                                            |
| `secrets set [name] [value]` | Adds or changes a secret. Leave out the value to type it hidden, or your shell history keeps it. An `op://` value keeps it in 1Password. |
| `secrets delete [name]`      | Deletes a secret. `--confirm` skips the question.                                                                                        |
| `secrets encrypt`            | Encrypts every value typed into the file in plain text.                                                                                  |
| `secrets password`           | Changes the password of the secrets file. Every value is encrypted again, and the old password stops working.                            |
| `secrets forget`             | Forgets every secret that Circuit remembers for a while.                                                                                 |

| `secrets password` option | Does                                                                                                               |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `--1password <reference>` | Reads the password from [1Password](/integrations/1password) from now on, such as `op://Network/Circuit/password`. |
| `--forget-1password`      | Stops reading the password from 1Password. Circuit asks for it again.                                              |
| `--confirm`               | Changes it without asking, to the value of `CIRCUIT_SECRETS_NEW_PASSWORD`.                                         |

## Circuit itself

| Command               | Does                                                                                                                                                |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `new [folder]`        | Starts a project. `--full` makes a [full install](/guide/install#full-install). See [Start a project](/guide/install#start-a-project).              |
| `update`              | Moves the project to a newer version you pick. Outside a project, or with `--app`, updates Circuit itself. See [Updating](/guide/install#updating). |
| `uninstall`           | Removes Circuit from this machine. Your projects stay.                                                                                              |
| `migrate <v0-folder>` | Converts a Circuit 0.x project, with its packages installed, to v1. Its `MIGRATION.md` lists what didn't move.                                      |

`update` and `uninstall` take `--confirm` to go ahead without asking. `update --confirm` takes the newest version.

| `migrate` option  | Does                                                                                                                 |
| ----------------- | -------------------------------------------------------------------------------------------------------------------- |
| `--out <folder>`  | An empty folder for the v1 project. Default `<v0-folder>-v1`.                                                        |
| `--config <file>` | The 0.x config file in that folder. Default `circuit.config.ts`.                                                     |
| `--yes`           | Copies the 0.x project's `.env` into the secrets without asking. The password comes from `CIRCUIT_SECRETS_PASSWORD`. |
