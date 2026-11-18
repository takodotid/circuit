---
description: Keep the password that opens your secrets in 1Password, or the secrets themselves. Circuit reads op:// references by itself.
---

# 1Password

Circuit reads from 1Password. It never creates or changes anything there.

Any value in a secrets file can be a 1Password reference, `op://vault/item/field`. Circuit reads it with the [1Password CLI](https://developer.1password.com/docs/cli/), `op`, by itself. You don't need `op run`, and you type the same `circuit` commands.

You need `op` installed and signed in. It may ask you to unlock 1Password once a session. Circuit can also remember what it read for a while, so 1Password asks less often. See [Remembering for a while](/guide/secrets#remembering-for-a-while).

There are two ways to use 1Password, and you can mix them:

|              | A. The password in 1Password (recommended)             | B. Values in 1Password                      |
| ------------ | ------------------------------------------------------ | ------------------------------------------- |
| In git       | `.circuit/secrets`, every value encrypted              | `.circuit/secrets`, with `op://` references |
| In 1Password | The one password that opens the file                   | Each password                               |
| Pick it when | You want secrets in git, opened by one shared password | The passwords are already in 1Password      |

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

Only a reference may go there. The commit check stops a password written in plain text. `circuit secrets list` tells you where Circuit gets the password now.

**A teammate** needs `op` signed in, with access to that vault. There is nothing to pass around, and Circuit never asks them for the password.

**To change the password**, run `circuit secrets password`, then put the new one in the same 1Password field. Until you do, the reference still reads the old one.

**To stop using 1Password**, run `circuit secrets password --forget-1password`. Circuit then asks for the password again.

To use 1Password in CI, see [Run in CI](/guide/ci).

## B. Values in 1Password

A value in the secrets file points to a 1Password field:

```sh
circuit secrets set SNMP_COMMUNITY op://Network/SNMP/password
```

```sh
# .circuit/secrets
SNMP_COMMUNITY="op://Network/SNMP/password"
```

The reference isn't encrypted, because it isn't a secret. It only says where to find one. `circuit secrets list` shows where each value is kept, never the value.
