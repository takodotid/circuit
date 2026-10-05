// Rules of your own. `circuit validate` runs them beside Circuit's own, and an error stops `diff` and `apply`.

import type { Check } from "@takodotid/circuit";
import { exportsEndInReject, neighborPolicies, trustBoundary } from "@takodotid/circuit/presets";

export default [
    // Nothing leaves by accident: every export ends by rejecting what it did not accept.
    exportsEndInReject,

    // Traffic from the transit and the exchange reaches the rest of the network only through the router.
    trustBoundary({ untrusted: ["transit", "ix"], routers: ["edge-01"] }),

    // Every BGP session filters what it takes in.
    (devices) =>
        devices.flatMap((device) =>
            neighborPolicies(device)
                .filter((neighbor) => !neighbor.import)
                .map((neighbor) => ({ level: "error" as const, device: device.name, message: `${neighbor.name} has no import policy` }))
        ),
] satisfies Check[];
