// Rules of your own. `circuit validate` runs them beside Circuit's own, and an error stops `diff` and `apply`.

import type { Check, Finding } from "@takodotid/circuit";
import { contains } from "@takodotid/circuit";
import { exportsEndInReject, trustBoundary } from "@takodotid/circuit/presets";
import { TENANTS } from "./tenants";

export default [
    // Nothing leaves by accident: every export ends by rejecting what it did not accept.
    exportsEndInReject,

    // Traffic from the transit and the exchange reaches the tenants only through the router, which filters it.
    trustBoundary({ untrusted: ["transit", "ix"], routers: ["edge-01"] }),

    // Tenants never share a name, a number or an address.
    () => {
        const findings: Finding[] = [];
        const error = (message: string) => findings.push({ level: "error", message });

        TENANTS.forEach((t, index) => {
            for (const other of TENANTS.slice(index + 1)) {
                if (other.name === t.name) error(`tenant ${t.name} is declared twice`);
                if (other.number === t.number) error(`tenants ${t.name} and ${other.name} share number ${t.number}`);

                for (const block of t.blocks) {
                    const clash = other.blocks.find(({ prefix }) => contains(prefix, block.prefix) || contains(block.prefix, prefix));
                    if (clash) error(`${block.prefix} of ${t.name} overlaps ${clash.prefix} of ${other.name}`);
                }
            }

            for (const { prefix, gateway } of t.blocks) {
                if (!contains(prefix, gateway)) error(`the gateway ${gateway} of ${t.name} is outside ${prefix}`);
            }
        });

        return findings;
    },
] satisfies Check[];
