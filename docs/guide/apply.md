---
description: What happens between your yes and a device that matches its file, and how Circuit keeps you from locking yourself out.
---

# How a change is applied

What happens after you say yes to `circuit apply`, and what keeps you safe if it goes wrong.

## The plan

1. Circuit turns the file into the vendor's own commands.
2. It logs in and reads what the device runs now.
3. It compares the two. Anything on the device that the file doesn't have gets removed or reset.

The order:

- **New and changed things go first**, in the order they depend on each other. A VLAN is made before a port joins it.
- **Removals go last**, in reverse. A port leaves a VLAN before the VLAN goes.
- **Ordered lists** (firewall chains, route policies) are swapped whole: new rules in first, old ones out after. There's never a moment with no rules.

## The dry run

Before changing anything, Circuit tests the plan where the platform allows:

| Platform     | Dry run                                                                     |
| ------------ | --------------------------------------------------------------------------- |
| RouterOS     | Compiles every command without running it.                                  |
| VRP          | Loads it as a candidate config. Any refused line throws the whole lot away. |
| Junos        | Loads it into a locked candidate and runs `commit check`.                   |
| Raisecom ROS | None. Runs each command and stops at the first one refused.                 |
| FortiOS      | None. Runs each line; if one is refused, reloads the saved config.          |

## How Circuit logs in

Circuit logs in over SSH as `connection.user`. When that user has `ssh_keys`, it tries a key first:

1. A key in your SSH agent: 1Password's, or the system's (`SSH_AUTH_SOCK`, or on Windows the OpenSSH agent's pipe).
2. `~/.ssh/id_ed25519`, `id_ecdsa` or `id_rsa`, when its `.pub` file is one of the user's `ssh_keys` and it has no passphrase.
3. The user's password, unlocked only now.

Circuit offers only the keys in `ssh_keys`, since some devices lock an account after a few refused tries. It says which way it logged in. When a device refuses the key and Circuit falls back to the password, it warns, so a broken key never hides behind the password.

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

The password keeps working over SSH beside the keys. On RouterOS, Circuit writes `/ip ssh password-authentication=yes` for that, since RouterOS turns password login off for a user once it has a key.

## Not locking you out

The scariest change is one that cuts off Circuit's own way in. So after every change, Circuit logs in again in a fresh session. The change only stays if that works.

| Platform       | Change goes live                | If Circuit can't log back in                                                               |
| -------------- | ------------------------------- | ------------------------------------------------------------------------------------------ |
| `routeros`     | command by command              | A backup is made first. The device restores it by itself after `--rollback` minutes (10).  |
| `vrp`          | all at once, `commit`           | Nothing was saved. A restart brings back the saved config.                                 |
| `raisecom-ros` | command by command              | Nothing was saved. A restart brings back the saved config.                                 |
| `junos`        | all at once, `commit confirmed` | Circuit rolls back. If it can't, the device does after `--rollback` minutes.               |
| `fortios`      | line by line                    | Circuit reloads the saved config. If it can't, the device does after `--rollback` minutes. |

## Checking afterwards

A device can take every command and still be broken. So on RouterOS, `apply` checks two things after sending:

1. **Switch rules.** None may be invalid. The switch chip holds fewer rules than the datasheet says, and a rule that doesn't fit silently stops working, along with every rule after it.
2. **BGP sessions.** Every session that was up before must be up again within 180 seconds. If one isn't, Circuit tells you why. Closed on its prefix limit? It gives you the `circuit bgp ... --clear-limit` to run once you know why.

If a check fails, `apply` fails, but the change stays. Fix it and apply again.

Other platforms have no after-checks yet.
