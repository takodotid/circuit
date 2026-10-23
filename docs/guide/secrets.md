# Secrets

Passwords, keys and tokens never go in your device files. A file only gives the secret's name, and Circuit looks up its value at the moment it sends a command. Plans, `build` output and `.circuit/state/` never contain a secret's value.

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
ROUTER_PASSWORD="has#a-hash"
```

Put quotes around a value that has a `#` in it. Without quotes, `#` starts a comment, so Circuit stops with an error rather than send a password cut short. A `#` after a space, as in `NAME=value # a note`, is a comment. Circuit reads `.env` the same way Node and Bun do.

`.env` must never be committed. `circuit new` adds it to `.gitignore` for you.

## A secret kept in 1Password

A value in `.env` can point to 1Password instead of being the secret itself:

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

The path is relative to `circuit.config.ts`. The certificate itself is public and belongs in the repository; its private key does not. `circuit new` adds `*.key.pem` to `.gitignore`.

## Check every secret

```bash
npx circuit secrets
```

lists every secret your files use, where each one comes from, and whether it can be read. It never prints a value. Run it after you set up a new computer, or when `apply` says a secret is missing.

## Changing a secret

A device never shows its passwords back, so Circuit cannot tell whether one changed. It sends a secret only when the thing that has it is new, such as a new user.

To change a password that already exists:

1. Change the value in `.env` or in 1Password.
2. Run `npx circuit apply <device> --secrets --confirm`. `--secrets` sends every secret the device has, including the new one.

On VRP, a password the switch had among its last ten is refused, so send `--secrets` only when a password really changed.

## In a tool of your own

A script of your own, such as one that reads counters from a device, can handle secrets the way Circuit does. `Secrets` has what it needs:

```ts
import { Secrets } from "@takodotid/circuit";
import network from "./circuit.config";

const device = network.devices.find((candidate) => candidate.name === "edge-01")!;

// How Circuit logs in: { host, port, user, password, console }. The password is the real value.
const login = Secrets.loginOf(device);

// The value of any secret in the config, from the environment, .env, 1Password or a file.
const token = Secrets.reveal(network.librenms!.api_token);

// Before you print what a device answered: every secret Circuit knows becomes <redacted>.
console.log(Secrets.scrub(output, { network }));
```

| Method                                    | What it gives                                                                                                                                                                                                                                 |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Secrets.reveal(secret)`                  | The value of a `secret(...)` or `secretFile(...)`, or of a variable named directly.                                                                                                                                                           |
| `Secrets.loginOf(device)`                 | The device's management address, SSH port (22 by default), connection user, that user's password, and its console.                                                                                                                            |
| `Secrets.scrub(text, { network, extra })` | The text with every secret replaced by `<redacted>`: each value in `.env` of six characters or more, each value read in this run, each secret `network` uses, and the values in `extra`. It never asks 1Password for a value just to hide it. |

Devices repeat what they are sent, passwords too, so scrub everything a device answered before you print it or save it.

Run the script from the project's directory, where `.env` is. From somewhere else, call `Secrets.useRoot("<the project's directory>")` first.
