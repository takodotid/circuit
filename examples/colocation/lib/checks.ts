// Our own checks, beside Circuit's. circuit.ts names them in `checks`.

import type { Check } from "circuit";

/** No two networks on one device overlap, such as two tenants' blocks: each address belongs to one tenant. */
export const blocksApart: Check = (network) =>
    network.devices.flatMap((device) => {
        const networks = Object.entries(device.interfaces?.vlan_interface ?? {}).flatMap(([name, vlan_interface]) =>
            (vlan_interface?.addresses ?? []).map((entry) => ({ name, prefix: typeof entry === "string" ? entry : entry.address }))
        );

        return networks.flatMap((one, index) =>
            networks
                .slice(index + 1)
                .filter((other) => other.name !== one.name && address.overlaps(one.prefix, other.prefix))
                .map((other) => ({
                    device: device.name,
                    path: `interfaces.vlan_interface.${other.name}`,
                    message: `${other.prefix} overlaps ${one.prefix} on ${one.name}. Give each its own block.`,
                }))
        );
    });
