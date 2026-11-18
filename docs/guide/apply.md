---
description: Edit a device's file, read the plan, and send it. What Circuit checks before and after, and how it keeps you from locking yourself out.
---

# Make a change

1. Edit the device's file.
2. Run `circuit validate`, and fix every error.
3. Run `circuit apply <device>`. Circuit reads the device and prints every command it would send, in the vendor's own language.
4. Read the plan. Then answer:

    ```
    ◆ Send these changes to edge-01?
    │ ○ Yes / ● No
    ```

    **No** is the default, so a stray Enter sends nothing.

5. Commit the file.

`circuit diff <device>` shows the same plan and sends nothing. Their options are in [the circuit command](/reference/cli#core).

## Making the plan

Each time you run `diff` or `apply`, Circuit turns the file into the vendor's commands and reads what the device runs now. The plan removes or resets anything on the device that the file doesn't have.

- **New and changed things go first**, in the order they depend on each other. A VLAN is made before a port joins it.
- **Removals go last**, in reverse order. A port leaves a VLAN before the VLAN goes.
- **Ordered lists**, such as firewall chains and route policies, are swapped whole. The new rules go in before the old ones come out, so there is never a moment with no rules.

If the device runs LLDP, Circuit also reads its neighbors, and warns you if a cable isn't where `link` says.

## The path check

A change sent over a bad link can cut the device off halfway. So `apply` first pings the device 20 times, for about 5 seconds:

```
path: 192.0.2.1: 0 of 20 pings lost (0%), 12 ms on average
```

If more than 5% are lost, or the average is over 300 ms, `apply` stops. Often the problem is on your side, such as a VPN. `--force` sends anyway. A device that never answers ping is not blocked.

## The dry run

Before it changes anything, Circuit tests the plan where the platform allows it:

| Platform     | Dry run                                                                        |
| ------------ | ------------------------------------------------------------------------------ |
| RouterOS     | Compiles every command without running it.                                     |
| VRP          | Loads the plan as a candidate config. If one line is refused, nothing is kept. |
| Junos        | Loads the plan into a locked candidate and runs `commit check`.                |
| Raisecom ROS | None. Runs each command and stops at the first one refused.                    |
| FortiOS      | None. Runs each line. If one is refused, it reloads the saved config.          |

## Not locking you out

After every change, Circuit logs in again in a new session. The change stays only if that works.

| Platform       | Change goes live                | If Circuit can't log back in                                                               |
| -------------- | ------------------------------- | ------------------------------------------------------------------------------------------ |
| `routeros`     | command by command              | A backup is made first. The device restores it by itself after `--rollback` minutes (10).  |
| `vrp`          | all at once, `commit`           | Nothing was saved. A restart brings back the saved config.                                 |
| `raisecom-ros` | command by command              | Nothing was saved. A restart brings back the saved config.                                 |
| `junos`        | all at once, `commit confirmed` | Circuit rolls back. If it can't, the device does after `--rollback` minutes.               |
| `fortios`      | line by line                    | Circuit reloads the saved config. If it can't, the device does after `--rollback` minutes. |

## Checking afterwards

On RouterOS only, `apply` checks three things after it sends.

1. **Switch rules.** If the plan changed switch rules, none may be invalid. A rule that doesn't fit the switch chip stops working without a word, and so does every rule after it.
2. **BGP sessions.** Every session that was up before must be up again within 180 seconds. If one closed on its prefix limit, Circuit prints the `circuit bgp ... --clear-limit` command to run once you know why.
3. **Announcements.** Each session must announce again the `originated_prefixes` it announced before. A session can stay up and still stop announcing.

If a check fails, `apply` fails, but the change stays on the device. Fix the problem and apply again.

## SSH keys and passwords

Circuit logs in over SSH as `connection.user`. If that user has `ssh_keys`, Circuit tries them in this order:

1. A key in your SSH agent, such as 1Password's or the system's (`SSH_AUTH_SOCK`).
2. `~/.ssh/id_ed25519`, `id_ecdsa`, or `id_rsa`, if its `.pub` file is in `ssh_keys` and it has no passphrase.
3. The user's password.

Circuit offers only the keys in `ssh_keys`, because some devices lock an account after a few failed tries. If the device refuses the key, Circuit warns you and uses the password.

```ts
system: {
    users: {
        netops: {
            role: "admin",
            password: secret("NETOPS_PASSWORD"),
            ssh_keys: ["ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGFuIGV4YW1wbGUga2V5LCBuZXZlciBhIHJlYWwgb25l alice@laptop"],
        },
    },
},
```

The password keeps working beside the keys. On RouterOS, Circuit writes `/ip ssh password-authentication=yes` for that.

## Prefix sets from a registry

Circuit fetches a prefix set with a `source` each time you run `diff` or `apply`. This one holds every prefix that AS64501 announces, from RIPEstat:

```ts
prefix_sets: {
    "customer-a-v4": { source: { registry: "ripe-stat", query: "AS64501", family: "ipv4" } },
},
```

The plan adds new prefixes and removes old ones one by one, so the list is never empty on the way. Circuit sends nothing if the answer is empty, fails, or has more than 100,000 prefixes. To keep the list current, [apply on a schedule](/guide/ci#read-and-change-devices).
