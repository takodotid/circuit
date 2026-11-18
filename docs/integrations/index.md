---
description: How circuit sync keeps NetBox, LibreNMS, PeeringDB, and Prometheus in sync with your project, what the plan shows, and how to use it in CI.
---

# How sync works

`circuit sync` copies what your project says into another system, so nobody types it in twice. It goes one way, from your project to that system. It reads only the project and that system, and never logs in to a device.

| Target                                 | What Circuit writes there                                                            |
| -------------------------------------- | ------------------------------------------------------------------------------------ |
| [NetBox](/integrations/netbox)         | Devices, ports, VLANs, addresses, and cables                                         |
| [LibreNMS](/integrations/librenms)     | Every device to monitor, with its SNMP settings, and a device group for each site    |
| [PeeringDB](/integrations/peeringdb)   | Your network's presence at each internet exchange                                    |
| [Prometheus](/integrations/prometheus) | Two files in your project: targets for Prometheus, credentials for the SNMP exporter |

[1Password](/integrations/1password) is different. Circuit reads your secrets from it, and never writes to it.

## Set up a target

Write the target in `circuit({ integrations })`, in `circuit.ts`. Each target's page shows how. `circuit validate` checks the settings. Keep a token or an API key in your [secrets](/guide/secrets), with `secret("NAME")`.

## Run a sync

```sh
circuit sync netbox             # shows what would change, then asks
circuit sync netbox --confirm   # sends without asking
circuit sync                    # pick the target from a list
```

1. Circuit reads the project. It stops on an error, as `apply` does.
2. It asks for your secrets' password if it needs a secret, such as the target's token.
3. It reads the other system and shows the plan.
4. It asks **Send these changes?** The answer is No by default.
5. It sends the changes, then reads the other system again. If something still differs, it shows what, and exits 1.

## Read the plan

- `+` makes an object, `~` changes one, and `-` deletes one. A change shows each field before and after.
- **Left alone** lists what Circuit sees but doesn't change, each with the reason. Read it, because it often says what to remove by hand.
- A secret's value never shows.

## Use it in CI

If Circuit runs without a terminal, as in CI, and you didn't add `--confirm`, it shows the plan and exits 1 without sending. So `circuit sync <target>` in CI fails when the other system no longer matches the project. If nothing needs to change, it exits 0. See [Run in CI](/guide/ci).

## Several networks in one project

If several networks in one project use the same system, Circuit plans them together. So a sync for one network never deletes what another network made.

| Target     | Planned together when the networks have |
| ---------- | --------------------------------------- |
| NetBox     | The same `url`                          |
| LibreNMS   | The same `url`                          |
| PeeringDB  | The same `asn`                          |
| Prometheus | The same `targets` and `auths` files    |
