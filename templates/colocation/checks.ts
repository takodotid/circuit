// Rules of your own. `circuit validate` runs them beside Circuit's own, and an error stops `diff` and `apply`.

import type { Check, Finding } from "@takodotid/circuit";
import { Address } from "@takodotid/circuit";
import { Checks } from "@takodotid/circuit/helpers";
import { blocksOf, type Tenant } from "./tenancy";
import { TENANTS } from "./tenants";

export default [
    // Nothing leaves by accident: every export ends by rejecting what it did not accept.
    Checks.exportsEndInReject,

    // Traffic from the transit and the exchange reaches the tenants only through the router, which filters it.
    Checks.trustBoundary({ untrusted: ["transit", "ix"], routers: ["edge-01"] }),

    // A native VLAN stays on one trunk and nowhere else, or it joins every trunk it is native on.
    Checks.nativeVlansAreDeadEnds,

    // Tenants never share a name, a VLAN, an address or a port. A port given twice would go to the last tenant alone.
    () => {
        const findings: Finding[] = [];
        const error = (message: string) => findings.push({ level: "error", message });
        const vlansOf = (t: Tenant) => [t.internet.vlan, ...(t.private ? [t.private.vlan] : [])];

        TENANTS.forEach((t, index) => {
            for (const other of TENANTS.slice(index + 1)) {
                if (other.name === t.name) error(`tenant ${t.name} is declared twice`);

                for (const vlan of vlansOf(t)) {
                    for (const theirs of vlansOf(other)) {
                        if (theirs.id === vlan.id)
                            error(`VLAN ${vlan.id} is both ${vlan.name} of ${t.name} and ${theirs.name} of ${other.name}`);
                        if (theirs.name === vlan.name) error(`VLAN ${vlan.name} is declared by both ${t.name} and ${other.name}`);
                    }
                }

                for (const block of blocksOf(t)) {
                    const clash = blocksOf(other).find((prefix) => Address.contains(prefix, block) || Address.contains(block, prefix));
                    if (clash) error(`${block} of ${t.name} overlaps ${clash} of ${other.name}`);
                }
            }

            for (const [device, ports] of Object.entries(t.ports)) {
                for (const port of Object.keys(ports)) {
                    const sharer = TENANTS.slice(index + 1).find((other) => other.ports[device]?.[port]);
                    if (sharer) error(`port ${port} on ${device} is given to both ${t.name} and ${sharer.name}`);
                }
            }
        });

        return findings;
    },
] satisfies Check[];
