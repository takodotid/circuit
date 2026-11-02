// Our own checks, beside Circuit's. circuit.ts names them in `checks`.

import type { Check } from "circuit";

/** Every port on the peering LAN says whose it is, so the NOC can find a member by its port. */
export const membersDescribed: Check = (network) =>
    network.devices.flatMap((device) =>
        Object.entries(device.interfaces?.ethernet ?? {})
            .filter(([, port]) => port?.access_vlan === "peering" && !port.description)
            .map(([name]) => ({
                device: device.name,
                path: `interfaces.ethernet.${name}`,
                message: "is on the peering LAN and says nothing about whose it is: write a description.",
            }))
    );
