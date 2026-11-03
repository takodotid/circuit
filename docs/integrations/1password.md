---
description: Keep the key that opens .env in 1Password, or keep the passwords themselves there.
---

# 1Password

Two ways. You can mix them.

|              | A. Only the key in 1Password (recommended)        | B. Values in 1Password                  |
| ------------ | ------------------------------------------------- | --------------------------------------- |
| In git       | `.env`, every value encrypted                     | `.env`, with `op://` pointers           |
| In 1Password | The one key that opens `.env`                     | Each password                           |
| Pick it when | You want secrets in git, opened by one shared key | The passwords already live in 1Password |

Both need the [1Password CLI](https://developer.1password.com/docs/cli/), `op`, signed in.

## A. Only the key in 1Password

`.env` stays encrypted in git. The key that opens it lives in 1Password instead of `.env.keys`.

```sh
# .env
DOTENV_PUBLIC_KEY="02b4…"
CIRCUIT_ENV_KEY="op://Network/Circuit env key/password"
EDGE_01_PASSWORD="encrypted:BHx…"
```

**New project:** pick 1Password when `circuit new` asks where to keep the key.

**Existing project:** move the key over.

```sh
circuit secret key 1password --vault Network
```

It saves the key as a new 1Password item, writes `CIRCUIT_ENV_KEY` into `.env`, checks it reads back, then deletes `.env.keys`. Commit `.env`.

| Command                        | Does                          |
| ------------------------------ | ----------------------------- |
| `circuit secret key`           | Shows where the key is now.   |
| `circuit secret key 1password` | Moves the key to 1Password.   |
| `circuit secret key file`      | Moves it back to `.env.keys`. |

**A teammate needs:** `op` signed in, with access to that vault. No `.env.keys` to pass around.

**Day to day:** just run `circuit`. `op` may ask you to unlock once a session (Touch ID, Windows Hello, or your password).

## B. Values in 1Password

A value in `.env` points at a 1Password field:

```sh
circuit secret set SNMP_COMMUNITY op://Network/SNMP/password
```

```sh
# .env
SNMP_COMMUNITY="op://Network/SNMP/password"
```

The pointer isn't encrypted: it's not a secret, only where to find one. Circuit reads it with `op` when it needs it. `circuit secret` shows where it lives, never the value.
