# Secrets

A secret is a reference in the config and a value only at the moment a command is sent. Rendered config, plans and snapshots never hold one.

## From a variable

```ts
import { secret } from "@takodotid/circuit";

users: { operator: { role: "admin", password: secret("SW1_PASSWORD") } },
```

The value comes from the environment first, then `.env.local` in the project root:

```bash
SW1_PASSWORD=...
```

## From a file

A value that spans lines, such as a private key in PEM, reads better as a file:

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

The path is relative to the project root. The certificate is public and belongs in the repository; its key does not. Keep key files out of git:

```
*.key.pem
```

## Sending secrets

A device does not print its secrets back, so a plan cannot tell whether one changed. Circuit sends a secret when the object holding it is new. To rotate one, change the value and apply with `--secrets`, which sends every secret the device holds.
