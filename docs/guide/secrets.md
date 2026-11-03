---
description: Passwords and keys live encrypted in .env, safe to commit. The key to open them never goes into git.
---

# Secrets

<img class="illustration" src="/illustrations/guide/secrets.webp" alt="A file of scrambled lines behind a padlock, its key kept apart on a card, and a line from the padlock to a router." width="1536" height="1024">

Passwords never go in a device's file. The file only names them:

```ts
users: { operator: { role: "admin", password: secret("EDGE_01_PASSWORD") } },
```

The value goes in `.env`, encrypted:

```sh
circuit secret set EDGE_01_PASSWORD
```

Circuit asks for the value without showing it. It only decrypts it when sending a command to the device. In any output, a secret shows as `<redacted>`.

## How it works

<SecretsDiagram />

- **`.env` is encrypted**, the [dotenvx](https://dotenvx.com) way. Safe to commit, so your team shares secrets through git.
- **The public key** (top of `.env`) can only lock. Anyone can add a secret.
- **The private key** unlocks. It never goes into git. Circuit looks for it in:
    1. `DOTENV_PRIVATE_KEY` in the environment, like in CI.
    2. `.env.keys` in the project. `.gitignore` keeps it out of git.
    3. 1Password, if `.env` has `CIRCUIT_ENV_KEY="op://vault/item/field"`. See [1Password](/integrations/1password).

Keep a copy of the private key in your password manager. Lose it, and every secret has to be set again.

## Commands

| Command                      | Does                                                                                                    |
| ---------------------------- | ------------------------------------------------------------------------------------------------------- |
| `circuit secret`             | Lists every secret and how it's kept. Flags ones the config needs but `.env` lacks. Never shows values. |
| `circuit secret set NAME`    | Adds or changes one. Asks for the value, hidden.                                                        |
| `circuit secret get NAME`    | Prints one, decrypted.                                                                                  |
| `circuit secret delete NAME` | Removes one, after asking.                                                                              |
| `circuit secret encrypt`     | Encrypts values typed into `.env` by hand. Already encrypted ones and `op://` pointers are left alone.  |
| `circuit secret rotate`      | Makes a new key. The old one stops working.                                                             |

Tip: `circuit secret set NAME value` works too, but then your shell history has the value. Better to let it ask.

## 1Password

Keep the key in 1Password, so nobody passes `.env.keys` around, or keep the passwords themselves there. See [1Password](/integrations/1password).

## Rotating the key

Do it when someone with the key leaves, or the key may have leaked.

1. `circuit secret rotate`.
2. Commit `.env`.
3. Share the new key with your team. (In 1Password? Nothing to share.)

Rotating changes the key, not the passwords. If a password leaked, change it on the device: `circuit secret set`, then `circuit apply <device> --secrets`.

## The commit check

In a git project, Circuit adds a git hook. Before every commit, from the terminal, VS Code or GitHub Desktop, it stops the commit if:

- `.env` has a value in plain text. Fix: `circuit secret encrypt`, then stage `.env` again.
- `.env.keys` is about to be committed.
- The project fails `circuit validate`.

It can't catch everything:

- `git commit --no-verify` skips it.
- Edits on the GitHub website skip it.
- On a fresh clone it works once Circuit has run there.

A plain-text password that reached a pushed commit is out. Deleting the commit doesn't help. Change the password on the device.

## Other ways

- **Environment variable:** `EDGE_01_PASSWORD=... circuit apply edge-01`. It wins over `.env`.
- **A file:** `secretFile("keys/wg-edge-01.key")` reads a file in the project, like a private key. Keep that file out of git.
