// Rules of your own. `circuit validate` runs them beside Circuit's own, and an error stops `diff` and `apply`.

import type { Check } from "@takodotid/circuit";
import { vlansOf } from "@takodotid/circuit/presets";

export default [
    // A port without a description is hard to trace later. A warning, so it does not block anything.
    (devices) =>
        devices.flatMap((device) =>
            Object.entries(device.ports ?? {})
                .filter(([, port]) => port && !port.description)
                .map(([name]) => ({ level: "warning" as const, device: device.name, message: `port ${name} has no description` }))
        ),

    // Someone plugging into a wall socket must not land on the management network. Only a trunk between devices carries it.
    (devices) =>
        devices.flatMap((device) =>
            Object.entries(device.ports ?? {})
                .filter(([, port]) => port?.access_vlan && vlansOf(port).includes("mgmt"))
                .map(([name]) => ({
                    level: "error" as const,
                    device: device.name,
                    message: `port ${name} gives management to whatever plugs in`,
                }))
        ),
] satisfies Check[];
