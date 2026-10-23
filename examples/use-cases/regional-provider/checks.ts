// Rules of this network's own, beside Circuit's.

import type { Check, Finding } from "@takodotid/circuit";
import { Address } from "@takodotid/circuit";
import { Checks } from "@takodotid/circuit/helpers";
import { CUSTOMERS } from "./customers";
import { OURS } from "./network";

export default [
    // Nothing leaves by accident: every export but a customer's ends by rejecting what it did not accept.
    Checks.exportsEndInReject,

    // Traffic from the transits and the exchange reaches the customers only through an edge router, which filters it.
    Checks.trustBoundary({ untrusted: ["transit-a", "transit-b", "transit-c", "ix"], routers: ["edge-a1", "edge-a2", "edge-b1"] }),

    Checks.tunnelsOutsideOffered,

    // Customers never share a name, a number or an address, take their blocks from our space, and announce only their own.
    (devices) => {
        const findings: Finding[] = [];
        const error = (message: string) => findings.push({ level: "error", message });
        const switches = new Set(devices.map((device) => device.name));

        CUSTOMERS.forEach((c, index) => {
            const blocks = [c.ipv4, ...(c.routed ?? [])];

            for (const other of CUSTOMERS.slice(index + 1)) {
                if (other.name === c.name) error(`customer ${c.name} is declared twice`);
                if (other.number === c.number) error(`customers ${c.name} and ${other.name} share number ${c.number}`);

                for (const block of blocks) {
                    const clash = [other.ipv4, ...(other.routed ?? [])].find(
                        (theirs) => Address.contains(theirs, block) || Address.contains(block, theirs)
                    );
                    if (clash) error(`${block} of ${c.name} overlaps ${clash} of ${other.name}`);
                }
            }

            for (const block of blocks) if (!Address.contains(OURS.v4, block)) error(`${block} of ${c.name} is outside ${OURS.v4}`);

            for (const prefix of c.bgp?.prefixes ?? []) {
                if (Address.contains(OURS.v4, prefix) || Address.contains(OURS.v6, prefix))
                    error(`${c.name} announces ${prefix}, which is ours`);
                if (prefix.includes(":") && !c.ipv6) error(`${c.name} announces ${prefix} without an IPv6 /64 to announce it from`);
            }

            for (const device of Object.keys(c.ports))
                if (!switches.has(device)) error(`${c.name} has ports on ${device}, which is not in the network`);
        });

        return findings;
    },
] satisfies Check[];
