# Commands

The CLI is `circuit`; a project usually runs it as `bun net`. It loads `circuit.config.ts` from the working directory, or the file `--config <path>` names. The state directory is relative to that file.

| Command                          | What it does                                                             | Touches a device       |
| -------------------------------- | ------------------------------------------------------------------------ | ---------------------- |
| `validate`                       | Checks the config and every rule in `checks`                             | no                     |
| `build <device>`                 | Prints the whole configuration the device should run                     | no                     |
| `diff [device...]`               | The plan against the last snapshot                                       | no                     |
| `snapshot [device...]`           | Reads what each device runs into the state directory                     | reads                  |
| `apply <device>`                 | Reads the device live and prints the plan; `--confirm` sends it          | yes, with `--confirm`  |
| `refresh <device>`               | Fills prefix sets fetched from a registry; `--confirm` sends             | yes, with `--confirm`  |
| `wireguard <device> <if> <peer>` | A client config for one peer, its private key left for the peer to fill  | no                     |
| `communities`                    | The network's BGP communities, for a looking glass or bgp.tools          | no                     |
| `peeringdb`                      | Brings PeeringDB's exchange records in line with the config; `--confirm` | PeeringDB, `--confirm` |

`apply` also takes:

- `--secrets`, to send every secret, when rotating one.
- `--rollback=N`, the minutes before a device that can restore itself does. 10 by default.

## Making a change

1. Edit the device's file.
2. `validate`, then `diff <device>` to see the change against the last snapshot, offline.
3. `apply <device>` reads the device live and prints the plan. Read every line: a `~ set` on a settings menu may turn something off.
4. `apply <device> --confirm` sends it.
5. Commit the config with the snapshot `apply` wrote.

`build` and `diff` never contact a device, so they are safe anywhere, including CI. `apply` sends nothing without `--confirm`.
