# The network

`circuit.config.ts` lists every device Circuit manages. Every command starts by reading it.

```ts
import { defineNetwork, secret } from "@takodotid/circuit";
import checks from "./checks";
import edge from "./edge-01";
import tor from "./tor-01";

export default defineNetwork({
    devices: [edge, tor],
    checks,

    asn: 64500,
    communities: [{ community: "64500:1:1", description: "Learned from a transit" }],
    peeringdb: { api_key: secret("PEERINGDB_API_KEY") },
});
```

| Field         | What it is                                                                           | Needed                |
| ------------- | ------------------------------------------------------------------------------------ | --------------------- |
| `devices`     | Every device Circuit manages                                                         | yes                   |
| `checks`      | Rules of your own that every change must pass                                        | no                    |
| `asn`         | Your AS number, for what Circuit publishes about the network                         | only with `peeringdb` |
| `communities` | What your BGP communities mean, printed by `circuit communities`                     | no                    |
| `peeringdb`   | An API key, so `circuit peeringdb` can keep your PeeringDB record up to date         | no                    |
| `librenms`    | Where LibreNMS is and an API token, so `circuit librenms` can add your devices to it | no                    |

A network without BGP, such as a home or an office, only needs `devices`, and usually `checks`. See [Publishing the network](/guide/publishing) for the last three.

The file can have another name or live somewhere else. Then give its path to every command with `--config <path>`. `.circuit/`, `.env` and secret files are found next to it.

## Checks

A check is a rule about your network that Circuit cannot know on its own. For example: every port has a description, or a guest VLAN never reaches a port that carries management.

A check is a function. It gets every device and returns what it found. Each finding is an error or a warning:

- An **error** stops `diff` and `apply`, so a change that breaks the rule cannot reach a device.
- A **warning** is printed, and nothing is stopped.

`circuit validate` runs your checks next to Circuit's own. Circuit's own checks catch names that do not exist, addresses that are not addresses, and anything a device cannot do. They also compare what your devices say about each other:

- **Both ends of a cable** point to each other, and carry the same VLANs with the same MTU, speed and address prefix. One VLAN under two names is a warning.
- **An address** is on one device only. On two loopbacks it is a warning, since that is how anycast works.
- **A BGP session to another of your devices** has a session back from that device. That device is in the AS this end expects, and its session goes to the address this end starts from.
- **VRRP on one segment** gives each id one address, and each address one id, on every device.
- **A GRE or VXLAN tunnel to another of your devices** has a tunnel back, with the same VNI and port.

Here is a `checks.ts` with two rules of its own and two from the [presets](/guide/presets):

```ts
import type { Check } from "@takodotid/circuit";
import { Checks } from "@takodotid/circuit/presets";

export default [
    // A ready-made check: every BGP export ends by rejecting what it did not accept.
    Checks.exportsEndInReject,

    // A ready-made check, set up for this network: traffic from the transit reaches the rest only through the router.
    Checks.trustBoundary({ untrusted: ["transit"], routers: ["edge-01"] }),

    // A port without a description is hard to trace later. A warning, so it does not stop anything.
    (devices) =>
        devices.flatMap((device) =>
            Object.entries(device.ports ?? {})
                .filter(([, port]) => port && !port.description)
                .map(([name]) => ({ level: "warning" as const, device: device.name, message: `port ${name} has no description` }))
        ),

    // Someone plugging into a wall socket must not land on the management network.
    (devices) =>
        devices.flatMap((device) =>
            Object.entries(device.ports ?? {})
                .filter(([, port]) => port?.access_vlan && Checks.vlansOf(port).includes("mgmt"))
                .map(([name]) => ({
                    level: "error" as const,
                    device: device.name,
                    message: `port ${name} gives management to whatever plugs in`,
                }))
        ),
] satisfies Check[];
```

A finding has a `level`, a `message`, and the `device` it is about when it is about one device. Each pattern's `checks.ts` has more examples.

## The .circuit directory

Circuit writes into `.circuit/`, next to `circuit.config.ts`. Do not edit anything in it: an edit changes nothing on a device, and Circuit overwrites it.

`.circuit/state/` has one file per device: what the device ran when Circuit last read it, with secrets removed. `snapshot` and `apply` write it, and `diff` compares your files with it.

Commit `.circuit/` with your changes. Its git history is then the history of your network: what each device ran after each change.
