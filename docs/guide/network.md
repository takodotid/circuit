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

| Field         | What it is                                                                                                   | Needed                |
| ------------- | ------------------------------------------------------------------------------------------------------------ | --------------------- |
| `devices`     | Every device Circuit manages                                                                                 | yes                   |
| `checks`      | Rules of your own that every change must pass                                                                | no                    |
| `asn`         | Your AS number, for what Circuit publishes about the network                                                 | only with `peeringdb` |
| `communities` | What your BGP communities mean, printed by `circuit communities`                                             | no                    |
| `peeringdb`   | An API key, so `circuit peeringdb` can keep your PeeringDB record up to date                                 | no                    |
| `librenms`    | Where LibreNMS is and an API token, so `circuit librenms` can keep your devices in it                        | no                    |
| `site`        | The site each device is at, a function that gets a device and returns a name, for NetBox and LibreNMS groups | only with `netbox`    |
| `netbox`      | Where NetBox is, an API token and each device's role, so `circuit netbox` can write your network into it     | no                    |

A network without BGP, such as a home or an office, only needs `devices`, and usually `checks`. See [Publishing the network](/guide/publishing) for `communities` and `peeringdb`, [LibreNMS](/integrations/librenms) for `librenms`, and [NetBox](/integrations/netbox) for `site` and `netbox`.

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

Here is a `checks.ts` with two rules of its own and two from the [helpers](/guide/helpers):

```ts
import type { Check } from "@takodotid/circuit";
import { Checks } from "@takodotid/circuit/helpers";

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

`.circuit/state/` has one file per device: what the device ran when Circuit last read it, with secrets removed. `snapshot` and `apply` write it, and `diff` compares your files with it. Beside it, a `.lldp.json` file holds what the device saw over LLDP at the last `snapshot`; see [Checking the cabling](#checking-the-cabling).

Commit `.circuit/` with your changes. Its git history is then the history of your network: what each device ran after each change.

## Checking the cabling

A port's `link` says which device and port is at the other end of its cable. [LLDP](/guide/glossary#networking) lets the device find out what is really there: each end sends its name and port down the cable. `circuit snapshot` reads what each device sees and saves it in `.circuit/state/<device>.lldp.json`. `circuit validate` then compares it with `link`, and warns about:

1. **A cable in the wrong port:** LLDP sees another device or port than `link` names.
2. **A cable missing or down:** `link` is set, and LLDP sees nothing on the port.
3. **A cable not written down:** LLDP sees another of your devices on a port without `link`.

These are warnings, not errors: LLDP can be off at the far end, or on a port. Only ports where both ends run LLDP, by `lldp` on the device and on the port, are compared. A device whose neighbors were never read is not compared at all. `diff` and `apply` ignore what LLDP saw: it is what was plugged in, not config.

The far device is found by its name, which every platform sets as the device's hostname. A name with a domain after it, such as `tor-01.example.net`, matches `tor-01`. The far port is matched as that device's platform spells it, such as `10GE1/0/5` for `10g-5` on VRP.

No platform reads LLDP neighbors yet. Each platform's command for it, and the form of what it prints, must be proved on a real device first. Until then, `snapshot` says so for each device that runs LLDP, saves nothing, and `validate` has nothing to compare.
