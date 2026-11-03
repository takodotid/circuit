---
description: Passwords and keys live encrypted in .circuit/secrets, safe to commit. One password opens them, and it never goes into git.
---

# Secrets

<img class="illustration" src="/illustrations/guide/secrets.webp" alt="A file of scrambled lines behind a padlock, its key kept apart on a card, and a line from the padlock to a router." width="1536" height="1024">

Passwords never go in a device's file. The file only names them:

```ts
users: { operator: { role: "admin", password: secret("EDGE_01_PASSWORD") } },
```

The value goes in `.circuit/secrets`, encrypted:

```sh
circuit secrets set EDGE_01_PASSWORD
```

Circuit asks for the value without showing it. It only decrypts it when sending a command to the device. In any output, a secret shows as `<redacted>`.

## How it works

<SecretsDiagram />

- **`.circuit/secrets` is encrypted**, value by value. Each line is `NAME="encrypted:..."`: the names stay readable, so git shows which secret changed. Safe to commit, so your team shares secrets through git.
- **One password opens the file.** It is never written in the file, and never in `circuit.ts`. Circuit gets it from the first of:
    1. `CIRCUIT_SECRETS_PASSWORD` in the environment, like in CI. The password itself, or a 1Password reference.
    2. `CIRCUIT_SECRETS_PASSWORD="op://vault/item/field"` in the file. Only a 1Password reference may go there, so the whole team gets the password through 1Password. See [1Password](/integrations/1password).
    3. You. Circuit asks for it when a command needs a secret: `diff`, `apply`, `exec`, `bgp`, `access-console`, and reading or changing a secret.
- **Any value can be a 1Password reference** (`op://...`). Circuit reads it with the 1Password CLI when it needs it.

Keep the password in your password manager. Lose it, and every secret has to be set again.

## The first password

The first `circuit secrets set` asks you to choose a password, of at least 12 characters. Leave it empty, and Circuit makes one (32 characters) and shows it once. Save it in your password manager right then: Circuit doesn't keep it.

## Commands

`circuit secrets` alone, in a terminal, opens every secret in a text editor, decrypted, one `NAME=value` per line:

```
# Circuit's secrets, each value encrypted, so this file is safe to commit.
EDGE_01_PASSWORD=s3cret-value
SNMP_COMMUNITY=op://Network/SNMP/password
```

Change a value, add a line, delete one. **Ctrl+S** saves, each value encrypted again; **Esc** leaves (or Ctrl+X). Only values you changed get a new encryption, so git shows just those. The editor is part of Circuit, no other program needed. Nothing is written to disk decrypted, and the screen is cleared when you leave.

A value with a space at either end goes in quotes: `NAME=" value "`.

| Command                       | Does                                                                                                      |
| ----------------------------- | --------------------------------------------------------------------------------------------------------- |
| `circuit secrets list`        | Lists every secret and how it's kept. Flags ones the config needs but the file lacks. Never shows values. |
| `circuit secrets set NAME`    | Adds or changes one. Asks for the value, hidden.                                                          |
| `circuit secrets get NAME`    | Prints one, decrypted.                                                                                    |
| `circuit secrets delete NAME` | Removes one, after asking.                                                                                |
| `circuit secrets encrypt`     | Encrypts values typed into the file by hand. Encrypted ones and `op://` references are left alone.        |
| `circuit secrets password`    | Changes the password. Every value is encrypted again, and the old password stops working.                 |

Tip: `circuit secrets set NAME value` works too, but then your shell history has the value. Better to let it ask.

## Remembering for a while

After a command typed the password or read 1Password, Circuit asks whether to remember them: no, for 10 minutes, or for 30 minutes. Say yes, and the next commands don't ask again until then. It's off unless you say yes.

While Circuit remembers:

- Any program running as you on this computer can get those secrets, and 1Password doesn't ask you.
- Locking 1Password doesn't make Circuit forget them.

They're kept in memory by a small Circuit process, never in a file. They're gone when the time is up, when the computer restarts, or with `circuit secrets forget`. A command that used them says so, with the time they're kept until. In a script, Circuit never asks.

## Changing the password

Do it when someone who knows it leaves, or it may have leaked.

1. `circuit secrets password`. It asks for the old password, then the new one.
2. Commit `.circuit/secrets`.
3. Share the new password with your team. In 1Password? Put the new one in the same item.

The password opens the file. It isn't a device password. If a device password leaked, change it on the device: `circuit secrets set`, then `circuit apply <device> --secrets`.

In a script, `circuit secrets password --confirm` takes the new password from `CIRCUIT_SECRETS_NEW_PASSWORD`.

## Lab and staging

A lab or staging setup is usually other devices: a spare box or a virtual router. Write it as its own network, with its own file and its own password:

```ts
export const as64500 = circuit({ asn: 64500, sites: { ... } }); // .circuit/secrets
export const lab = circuit({ sites: { lab: { description: "Lab rack" } }, secrets: { file: ".circuit/lab-secrets" } });
```

`asn` is optional, so an office or home network without one works the same way. `circuit secrets` works on `.circuit/secrets`. For another file, name it with `--file`: `circuit secrets set EDGE_01_PASSWORD --file .circuit/lab-secrets`. A project whose networks all keep their secrets elsewhere needs `--file` every time.

## The commit check

In a git project, Circuit adds a git hook. Before every commit, from the terminal, VS Code or GitHub Desktop, it stops the commit if:

- A secrets file has a value in plain text. Fix: `circuit secrets encrypt`, then stage the file again.
- A secrets file holds its own password. Only `CIRCUIT_SECRETS_PASSWORD="op://..."` may be written there.
- The project fails `circuit validate`.

It checks every secrets file your networks use. `op://` references pass.

It can't catch everything:

- `git commit --no-verify` skips it.
- Edits on the GitHub website skip it.
- On a fresh clone it works once Circuit has run there.

A plain-text password that reached a pushed commit is out. Deleting the commit doesn't help. Change the password on the device.

Circuit refuses a value in plain text when it runs, too: it reads only encrypted values and `op://` references.

## Other ways

- **Environment variable:** `EDGE_01_PASSWORD=... circuit apply edge-01`. It wins over the file.
- **A file:** `secretFile("keys/wg-edge-01.key")` reads a file in the project, like a private key. Keep that file out of git.
