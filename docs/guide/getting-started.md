# Getting started

Circuit runs on [Bun](https://bun.sh) and ships as TypeScript source; there is nothing to build.

## Install

Circuit is published to GitHub Packages. Point the `@takodotid` scope at it in `bunfig.toml`, with a GitHub token that can read packages:

```toml
[install.scopes]
"@takodotid" = { token = "$GITHUB_TOKEN", url = "https://npm.pkg.github.com/" }
```

```bash
bun add @takodotid/circuit
```

Add a script so the CLI runs as `bun net`:

```json
{
    "scripts": {
        "net": "circuit"
    }
}
```

## A project

```
my-network/
  site-a/
    router.ts          one file per device
    switch.ts
  checks.ts            rules of your own design
  state/               what each device runs, written by the CLI
  circuit.config.ts    the devices that make up the network
  .env.local           secrets, never committed
```

A device:

```ts
import { defineDevice, secret } from "@takodotid/circuit";

export default defineDevice({
    name: "sw1",
    platform: "vrp",
    model: "CE6855-48S6Q-HI",
    connection: { host: "10.0.0.2", user: "operator" },
    users: { operator: { role: "admin", password: secret("SW1_PASSWORD") } },
    management: { allow: ["10.0.0.0/24"], ssh: {} },
    vlans: { mgmt: { id: 99 }, servers: { id: 100 } },
    ports: {
        "10g-1": { description: "server-1", access_vlan: "servers" },
        "40g-1": { description: "uplink", trunk_vlans: ["mgmt", "servers"] },
    },
    interfaces: { mgmt: { type: "vlan", vlan: "mgmt", addresses: ["10.0.0.2/24"] } },
    routing: { static: [{ prefix: "0.0.0.0/0", via: "10.0.0.1" }] },
});
```

The network, in `circuit.config.ts`:

```ts
import { defineNetwork } from "@takodotid/circuit";
import sw1 from "./site-a/switch";

export default defineNetwork({ devices: [sw1], state: "state" });
```

## First run

```bash
bun net validate          # the config and every check
bun net snapshot          # read what each device runs
bun net diff              # what applying would change
bun net apply sw1         # the live plan
bun net apply sw1 --confirm
```

The first plan against a device configured by hand is long: everything the config does not describe is removed. Read it before `--confirm`, and describe what should stay.
