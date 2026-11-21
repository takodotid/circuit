import type { Device } from "../../model";
import { RouterOsRouting } from "./routing";
import { RouterOsSyntax } from "./syntax";

/** What the model allows and the render does not write. */
export class RouterOsShapes {
    static unsupported(device: Device): string[] {
        const found: string[] = [];
        const firewall = device.firewall;
        const list = (value: unknown) => Array.isArray(value) && value.length > 1;

        if (firewall?.interface_sets) found.push("firewall.interface_sets, which the platform does not build yet");

        const chains = (["input", "forward", "output"] as const).map(
            (chain) => [`firewall.filter.${chain}.rules`, firewall?.filter?.[chain]?.rules] as const
        );
        const others = [
            ["firewall.nat.source", firewall?.nat?.source],
            ["firewall.nat.destination", firewall?.nat?.destination],
            ["qos.marking", device.qos?.marking],
        ] as const;

        for (const [where, rules] of [...chains, ...others]) {
            (rules ?? []).forEach((rule, index) => {
                for (const field of ["src", "dst", "in_interface", "out_interface"] as const) {
                    if (list(rule.if?.[field])) found.push(`${where}[${index}].if.${field}, a list: write one rule for each`);
                }

                for (const field of ["in_interface_set", "out_interface_set"] as const) {
                    if (rule.if?.[field] !== undefined) found.push(`${where}[${index}].if.${field}, which the platform does not build yet`);
                }
            });
        }

        for (const [name, rules] of RouterOsSyntax.entries(device.switching?.acls)) {
            rules.forEach((rule, index) => {
                for (const field of ["src", "dst", "vlan"] as const) {
                    if (list(rule.if?.[field])) found.push(`switching.acls.${name}[${index}].if.${field}, a list: write one rule for each`);
                }
            });
        }

        const allow = device.management?.allow;
        if (typeof allow === "string") found.push(`management.allow ${allow}, an address set by name: write its prefixes`);

        found.push(...RouterOsRouting.policyGaps(device));

        return found;
    }
}
