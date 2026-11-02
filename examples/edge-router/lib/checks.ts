// Our own checks, beside Circuit's. circuit.ts names them in `checks`.

import type { Check } from "circuit";

/** Every BGP session filters what it takes in. A neighbor without an import policy takes every route it is sent. */
export const importsFiltered: Check = (network) =>
    network.devices.flatMap((device) =>
        Object.entries(device.routing?.bgp?.neighbors ?? {})
            .filter(([, neighbor]) => !neighbor.import_policy)
            .map(([name]) => ({
                device: device.name,
                path: `routing.bgp.neighbors.${name}`,
                message: "takes every route it is sent: write an import_policy.",
            }))
    );
