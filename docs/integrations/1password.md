---
description: Keep the password that opens your secrets in 1Password, or the secrets themselves. Circuit reads op:// references by itself.
---

# 1Password

Circuit reads from 1Password. It never creates or changes anything there.

Any value in a secrets file can be a 1Password reference, `op://vault/item/field`. Circuit sees the `op://` and reads it with the [1Password CLI](https://developer.1password.com/docs/cli/), `op`, by itself. No `op run`: you type the same `circuit` commands.

You need `op` installed and signed in. It may ask you to unlock once a session (Touch ID, Windows Hello, or your password).

So 1Password asks less often, Circuit can remember what it read for 10 minutes, 30 minutes or 24 hours, only if you say yes. Read [Remembering for a while](/guide/secrets#remembering-for-a-while) first: while Circuit remembers, locking 1Password doesn't lock those values.

Two ways. You can mix them.

|              | A. The password in 1Password (recommended)             | B. Values in 1Password                      |
| ------------ | ------------------------------------------------------ | ------------------------------------------- |
| In git       | `.circuit/secrets`, every value encrypted              | `.circuit/secrets`, with `op://` references |
| In 1Password | The one password that opens the file                   | Each password                               |
| Pick it when | You want secrets in git, opened by one shared password | The passwords already live in 1Password     |

## A. The password in 1Password

1. Put the password into a 1Password field yourself.
2. Tell Circuit where it is:

    ```sh
    circuit secrets password --1password "op://Network/Circuit/password"
    ```

    Circuit checks that it opens the file, then writes the reference in it:

    ```sh
    # .circuit/secrets
    CIRCUIT_SECRETS_PASSWORD="op://Network/Circuit/password"
    EDGE_01_PASSWORD="encrypted:AQx…"
    ```

3. Commit `.circuit/secrets`.

Only a reference may go there: a password written as itself is stopped by the commit check. `circuit secrets list` tells you where Circuit gets the password now.

**A teammate needs:** `op` signed in, with access to that vault. Nothing to pass around, and Circuit never asks them for the password.

**Changing the password:** `circuit secrets password`, then put the new one in the same 1Password field. Until you do, the reference still reads the old one.

**Stop using 1Password:** `circuit secrets password --forget-1password`. Circuit asks for the password again.

In CI, give `CIRCUIT_SECRETS_PASSWORD="op://..."` in the environment instead, with a 1Password service account.

## B. Values in 1Password

A value in the secrets file points at a 1Password field:

```sh
circuit secrets set SNMP_COMMUNITY op://Network/SNMP/password
```

```sh
# .circuit/secrets
SNMP_COMMUNITY="op://Network/SNMP/password"
```

The reference isn't encrypted: it isn't a secret, only where to find one. `circuit secrets list` shows where it lives, never the value.
