# Secrets

Passwords, keys and tokens never go in your device files. A file only names the secret, and Circuit looks up its value at the moment it sends a command. Plans, `build` output and `.circuit/state/` never contain a secret's value.

## A secret by name

```ts
import { secret } from "@takodotid/circuit";

users: { operator: { role: "admin", password: secret("SWITCH_PASSWORD") } },
```

Circuit looks for `SWITCH_PASSWORD` in two places, in this order:

1. The environment, such as a variable set by your shell or by CI.
2. `.env`, next to `circuit.config.ts`.

```bash
# .env
SWITCH_PASSWORD=correct-horse-battery-staple
```

`.env` must never be committed. `circuit new` adds it to `.gitignore` for you.

## A secret kept in 1Password

A value in `.env` can point at 1Password instead of holding the secret:

```bash
# .env
SWITCH_PASSWORD=op://Network/switch/password
```

Circuit then reads it with the 1Password CLI. See [1Password](/integrations/1password) for how to set it up.

## A secret in a file

Some secrets are long and span several lines, such as a private key. Keep those in a file, out of git:

```ts
import { readFileSync } from "node:fs";
import { secretFile } from "@takodotid/circuit";

certificates: {
    web: {
        certificate: readFileSync("certificates/web.pem", "utf8"),
        private_key: secretFile("certificates/web.key.pem"),
    },
},
```

The path is relative to `circuit.config.ts`. The certificate itself is public and belongs in the repository; its private key does not. `circuit new` ignores `*.key.pem` in `.gitignore`.

## Check every secret

```bash
bun circuit secrets
```

lists every secret your files use, where each one comes from, and whether it can be read. It never prints a value. Run it after you set up a new computer, or when `apply` says a secret is missing.

## Changing a secret

A device never shows its passwords back, so Circuit cannot tell whether one changed. It sends a secret only when the thing holding it is new, such as a new user.

To change a password that already exists:

1. Change the value in `.env` or in 1Password.
2. Run `bun circuit apply <device> --secrets --confirm`. `--secrets` sends every secret the device holds, including the new one.
