import { Derive } from "../../core/derive";
import type { Device, Rate } from "../../model";

/** What a rate limit, and an ACL rule's rate, can't be here. */
export class JunosRateLimits {
    /** The burst a refusal suggests for a policer, in seconds at its rate. */
    private static readonly SUGGESTED_BURST_SECONDS = 0.01;

    /**
     * A policer needs a burst. What arrives is policed in the switching family's input filter, which a port has one of. What leaves is shaped on a port: on a LAG the QFX shapes each member to the rate, and a VLAN interface has no shaper (Juniper's QFX port shaping page).
     */
    static gaps(device: Device): string[] {
        const found: string[] = [];

        for (const { where, kind, name, rateLimit } of Derive.rateLimited(device)) {
            const settings = kind === "lag" ? device.interfaces?.lag?.[name] : device.interfaces?.ethernet?.[name];
            const one = Derive.oneRate(rateLimit.input);
            const input = one && Derive.limit(one);
            // Juniper's QFX pages on tricolor marking and on rewrite rules.
            if (rateLimit.input && !one)
                found.push(
                    `${where}.rate_limit.input, two rates: a QFX5100's two-rate policer gives what passes above cir a loss priority, and only a rewrite rule writes a DSCP by it, which rewrites every packet of each class. Write one rate`
                );

            if (input) {
                if (kind === "vlan_interface") found.push(`${where}.rate_limit.input, on a VLAN interface, which is not built yet`);
                else if (!settings?.access_vlan && !settings?.trunk_vlans)
                    found.push(`${where}.rate_limit.input, on a port or LAG that switches no VLAN, which is not built yet`);

                const port = kind === "ethernet" ? device.interfaces?.ethernet?.[name] : undefined;
                if (port?.ingress_acl) found.push(`${where}.rate_limit.input with an ingress_acl, the port takes one filter`);
                if (settings?.ethertypes) found.push(`${where}.rate_limit.input with ethertypes, the port takes one filter`);
                if (settings?.bound_to) found.push(`${where}.rate_limit.input with bound_to, the port takes one filter`);
                if (input.burst === undefined) found.push(JunosRateLimits.noBurst(`${where}.rate_limit.input`, input.rate));
            }

            // `commit check` passes a port's shaping-rate, but `show class-of-service` marks it ignored (TRAPS.md).
            if (rateLimit.output)
                found.push(
                    `${where}.rate_limit.output, which a QFX5100 doesn't keep: Junos ignores a port's shaping-rate there. Limit it where the traffic comes in, or on the far device`
                );
            if (rateLimit.per_prefix)
                found.push(
                    `${where}.rate_limit.per_prefix, which a QFX5100 can't police: Junos ignores prefix-action, its policer for each prefix, there`
                );
        }

        for (const [name, rules] of Object.entries(device.switching?.acls ?? {}))
            (rules ?? []).forEach((rule, index) => {
                const limit = rule.rate && Derive.limit(rule.rate);
                if (limit && limit.burst === undefined)
                    found.push(JunosRateLimits.noBurst(`switching.acls.${name}[${index}].rate`, limit.rate));
            });

        return found;
    }

    /** A rate without the burst a policer needs, with a burst to write: 10 ms at the rate. */
    private static noBurst(where: string, rate: Rate): string {
        const burst = (Derive.bitsPerSecond(rate) * JunosRateLimits.SUGGESTED_BURST_SECONDS) / Derive.BITS_PER_BYTE;
        return `${where} without bc, the platform's policer needs a burst: write { cir: "${rate}", bc: ${burst} }, 10 ms at the rate, or a burst of your own`;
    }
}
