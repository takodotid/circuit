// This network's own checks, beside Circuit's built-in ones. circuit.ts turns them on in `checks`.

import type { Check } from "circuit";

/** Someone who plugs into a wall socket must not land on the management network: only a trunk between devices carries it. */
export const managementStaysOnTrunks: Check = (network) =>
    network.devices.flatMap((device) =>
        Object.entries(device.interfaces?.ethernet ?? {})
            .filter(([, port]) => port?.access_vlan === "mgmt")
            .map(([name]) => ({
                device: device.name,
                path: `interfaces.ethernet.${name}`,
                message: "gives management to whatever plugs in. Put the port in another VLAN.",
            }))
    );
