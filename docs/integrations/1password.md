---
description: Keep the key that opens .env in 1Password, or the passwords themselves. Circuit reads op:// references by itself.
---

# 1Password

Circuit reads from 1Password. It never creates or changes anything there.

Any value in `.env` can be a 1Password reference, `op://vault/item/field`. Circuit sees the `op://` and reads it with the [1Password CLI](https://developer.1password.com/docs/cli/), `op`, by itself. No `op run`: you type the same `circuit` commands.

You need `op` installed and signed in. It may ask you to unlock once a session (Touch ID, Windows Hello, or your password).

Two ways. You can mix them.

|              | A. The key in 1Password (recommended)             | B. Values in 1Password                  |
| ------------ | ------------------------------------------------- | --------------------------------------- |
| In git       | `.env`, every value encrypted                     | `.env`, with `op://` pointers           |
| In 1Password | The one key that opens `.env`                     | Each password                           |
| Pick it when | You want secrets in git, opened by one shared key | The passwords already live in 1Password |

## A. The key in 1Password

1. Put the key into 1Password yourself: copy the value of `DOTENV_PRIVATE_KEY` from `.env.keys` into a 1Password field.
2. Write its reference in `.env`:

    ```sh
    # .env
    DOTENV_PUBLIC_KEY="02b4…"
    DOTENV_PRIVATE_KEY="op://Network/Circuit/key"
    EDGE_01_PASSWORD="encrypted:BHx…"
    ```

3. Delete `.env.keys`, and commit `.env`.

`circuit secret key` tells you where Circuit finds the key now.

**A teammate needs:** `op` signed in, with access to that vault. Nothing to pass around.

**Rotating:** `circuit secret rotate` writes the new key to `.env.keys`. Put it into 1Password in place of the old one, then delete `.env.keys`.

## B. Values in 1Password

A value in `.env` points at a 1Password field:

```sh
circuit secret set SNMP_COMMUNITY op://Network/SNMP/password
```

```sh
# .env
SNMP_COMMUNITY="op://Network/SNMP/password"
```

The pointer isn't encrypted: it isn't a secret, only where to find one. `circuit secret` shows where it lives, never the value.
