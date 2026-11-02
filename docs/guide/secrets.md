# Secrets

A password, a BGP key or an SNMP community is never written in a device's file. The file names it, and its value is in `.env`, encrypted:

```ts
system: {
    users: { operator: { role: "admin", password: secret("EDGE_01_PASSWORD") } },
},
```

```sh
circuit env set EDGE_01_PASSWORD
```

Circuit asks for the value without showing it, encrypts it, and writes it to `.env`. It reads the value only when it sends a command to the device. Plans and output never show it: Circuit replaces every secret it knows with `<redacted>`.

## How it works

<SecretsDiagram />

1. `.env` holds each secret encrypted, the way [dotenvx](https://dotenvx.com) encrypts it. It is safe to commit, so the whole team shares the same secrets through git.
2. The **public key** at the top of `.env` can only encrypt. Anyone can add a secret.
3. The **private key** decrypts. It is never committed. Circuit looks for it in this order:
    1. `DOTENV_PRIVATE_KEY` in the environment, such as in CI.
    2. `.env.keys` in the project folder. `.gitignore` keeps it out of git.
    3. 1Password, when `.env` has `CIRCUIT_ENV_KEY="op://vault/item/field"`. Circuit reads it with the 1Password CLI, `op`.

Keep a copy of the private key in your password manager. Without it, nobody can read `.env`, and every secret must be set again.

## The commands

| Command                   | What it does                                                                                    |
| ------------------------- | ----------------------------------------------------------------------------------------------- |
| `circuit env`             | Lists every secret, how it is kept, and the ones the config needs that `.env` lacks. No values. |
| `circuit env set NAME`    | Adds or changes a secret, encrypted. It asks for the value without showing it.                  |
| `circuit env get NAME`    | Prints one secret, decrypted.                                                                   |
| `circuit env delete NAME` | Removes a secret, after asking. `--confirm` skips the question.                                 |
| `circuit env encrypt`     | Encrypts every value written into `.env` by hand.                                               |
| `circuit env rotate`      | A new key. Every secret is encrypted again, and the old key stops working.                      |

`circuit env set NAME value` takes the value on the command line too, but your shell then keeps it in its history. Leave it out, and type it when asked.

## Keeping a secret in 1Password

A value in `.env` may be a 1Password reference instead of an encrypted value:

```sh
circuit env set SNMP_COMMUNITY op://Network/SNMP/password
```

Circuit reads it with the 1Password CLI each time it needs it. `circuit env` shows where it is kept, never the value.

To keep the private key itself in 1Password, pick 1Password when the installer asks. Each person then reads the key from the team's vault, and nobody has a `.env.keys` file.

## Rotating the key

Rotate when someone with the key leaves the team, or when the key may have leaked.

1. Run `circuit env rotate`. It asks first.
2. Commit `.env`.
3. Give the new key to your team. A key kept in 1Password is changed there, so there is nothing to give.

Rotating changes the key, not the secrets. A secret that leaked is still known: change it on the device. Set the new value with `circuit env set`, then `circuit apply --secrets` the device.

## The commit check

When the project is a git repository, Circuit installs a git hook in `.circuit/hooks`. Before each commit, from a terminal, VS Code or GitHub Desktop, it stops the commit when:

- `.env` holds a value in plain text. Run `circuit env encrypt`, then stage `.env` again.
- `.env.keys` is staged.
- The project doesn't pass `circuit validate`.

Every command also warns when `.env` holds a value in plain text.

The hook protects a normal commit, not every way into git:

- `git commit --no-verify` skips it.
- An edit made on the GitHub website skips it.
- A clone runs it only once Circuit has run there, and only where Circuit is installed.

If a secret in plain text reaches a pushed commit, treat it as known to everyone who can read the repository. Removing the commit doesn't take it back. Change it on the device.

## Other ways to give a secret

- **From the environment.** `EDGE_01_PASSWORD=... circuit apply edge-01`. A variable in the environment wins over `.env`.
- **From a file.** `secretFile("keys/wg-edge-01.key")` reads a file in the project, such as a private key. Keep the file out of git.
