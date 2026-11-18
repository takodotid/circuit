// This network's own checks, beside Circuit's built-in ones. circuit.ts turns them on in `checks`.

import type { Check } from "circuit";

/** Every BGP neighbor has an import policy. Without one, the router accepts no route from it. */
export const importsFiltered: Check = (network) =>
    network.devices.flatMap((device) =>
        Object.entries(device.routing?.bgp?.neighbors ?? {})
            .filter(([, neighbor]) => !neighbor.import_policy)
            .map(([name]) => ({
                device: device.name,
                path: `routing.bgp.neighbors.${name}`,
                message: "has no import_policy, so the router accepts no route from it. Write one.",
            }))
    );
