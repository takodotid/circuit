# The network

`circuit.config.ts` at the root of the project declares the network. Another name or place works too, with `--config <path>` on every command:

```ts
import { defineNetwork, secret } from "@takodotid/circuit";
import { checks } from "./checks";
import router from "./site-a/router";
import sw1 from "./site-a/switch";

export default defineNetwork({
    devices: [router, sw1],
    checks,
    state: "state",

    asn: 64500,
    communities: [{ community: "64500:0:nnn", description: "Do not announce to AS$0" }],
    peeringdb: { api_key: secret("PEERINGDB_API_KEY") },
});
```

| Field         | What it holds                                                                           |
| ------------- | --------------------------------------------------------------------------------------- |
| `devices`     | Every device Circuit manages                                                            |
| `checks`      | Rules of your own design, run by `validate` beside Circuit's own                        |
| `state`       | Where snapshots of what each device runs are kept, relative to the project root         |
| `asn`         | The AS the network operates, for what is published about it                             |
| `communities` | The BGP communities the network defines, printed by `communities`                       |
| `peeringdb`   | The API key `peeringdb` uses to keep the network's PeeringDB record in step with config |

## Checks

A check sees every device and returns findings. An error stops `diff` and `apply`; a warning is reported only.

```ts
import type { Check } from "@takodotid/circuit";

export const everyPortDescribed: Check = (devices) =>
    devices.flatMap((device) =>
        Object.entries(device.ports ?? {})
            .filter(([, port]) => port && !port.description)
            .map(([name]) => ({ level: "warning" as const, device: device.name, message: `port ${name} has no description` }))
    );
```

Circuit's own checks cover the rest: names that do not exist, addresses that are not addresses, links whose two ends disagree, and every field a platform cannot express.

## State

`snapshot` and `apply` write what each device runs into `state`, with secrets removed. Commit it: the history of `state` is the history of the network. A `README.md` there says the directory is generated, and an edit to it changes nothing.
