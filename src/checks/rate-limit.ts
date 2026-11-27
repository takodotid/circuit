import { Address } from "../core/address";
import { Derive } from "../core/derive";
import type { Device, Limit, PerPrefix, TwoRateLimit } from "../model";

type Report = (message: string) => void;

/** Rate limits as RFC 2697 has them: a rate above 0, and a burst of whole bytes. Or two rates, as RFC 2698 has them. */
export class RateLimitChecks {
    /** A rate: a number, then `k`, `M`, or `G`. */
    private static readonly RATE = /^(\d+(\.\d+)?)[kMG]$/;

    /** Each rate limit limits something, on the LAG rather than its members. CAKE's shaping already limits what leaves. */
    static check(device: Device, report: Report): void {
        for (const { where, kind, name, rateLimit } of Derive.rateLimited(device)) {
            if (!rateLimit.input && !rateLimit.output && !rateLimit.per_prefix)
                report(`${where}.rate_limit limits nothing: write input, output, per_prefix, or several`);
            for (const direction of ["input", "output"] as const) {
                const limit = rateLimit[direction];
                if (limit) RateLimitChecks.limit(`${where}.rate_limit.${direction}`, limit, report);
            }

            if (rateLimit.per_prefix) RateLimitChecks.perPrefix(`${where}.rate_limit.per_prefix`, rateLimit.per_prefix, report);

            const lag = kind === "ethernet" ? device.interfaces?.ethernet?.[name]?.in_lag : undefined;
            if (lag) report(`${where}.rate_limit is on a member of ${lag}: write it on the LAG`);
            const output = Derive.limitsOutput(rateLimit);
            if (output && Derive.settings(device, name)?.shaping)
                report(`${where}.rate_limit.${output} beside shaping, which also limits what leaves: write one of them`);
        }

        for (const [name, rules] of Object.entries(device.switching?.acls ?? {}))
            (rules ?? []).forEach((rule, index) => {
                if (rule.rate) RateLimitChecks.limit(`switching.acls.${name}[${index}].rate`, rule.rate, report);
            });
    }

    /** Whether `rate` is a rate above 0. Reports it when it is not. */
    static rate(where: string, rate: unknown, report: Report): boolean {
        const amount = typeof rate === "string" ? RateLimitChecks.RATE.exec(rate)?.[1] : undefined;
        if (amount && Number(amount) > 0) return true;
        report(`${where} ${typeof rate === "string" ? rate : JSON.stringify(rate)} is not a rate above 0, such as 200M, 1.5G, or 64k`);
        return false;
    }

    /** A rate each way, at least one, and each family's prefix length, from a single address down to a /1. */
    private static perPrefix(where: string, perPrefix: PerPrefix, report: Report): void {
        if (!perPrefix.input && !perPrefix.output) report(`${where} limits nothing: write input, output, or both`);
        for (const direction of ["input", "output"] as const) {
            const rate = perPrefix[direction];
            if (rate !== undefined) RateLimitChecks.rate(`${where}.${direction}`, rate, report);
        }

        for (const family of ["ipv4", "ipv6"] as const) {
            const max = Address.bits(family);
            const length: unknown = perPrefix[family];
            if (!(typeof length === "number" && Number.isInteger(length) && length >= 1 && length <= max))
                report(
                    `${where}.${family} ${JSON.stringify(length)} is not a prefix length from 1 to ${max}: write ${max} for each address`
                );
        }
    }

    /** Two rates as RFC 2698 has them: each with a burst of whole bytes, the peak at least the committed rate. `QosChecks` checks the DSCP. */
    private static twoRate(where: string, limit: TwoRateLimit, report: Report): void {
        const cir = RateLimitChecks.rate(`${where}.cir`, limit.cir, report) ? limit.cir : undefined;
        const pir = RateLimitChecks.rate(`${where}.pir`, limit.pir, report) ? limit.pir : undefined;
        if (cir && pir && Derive.bitsPerSecond(pir) < Derive.bitsPerSecond(cir))
            report(`${where}.pir ${pir} is below cir, ${cir}: the peak rate is at least the committed one (RFC 2698)`);

        for (const key of ["bc", "be"] as const) {
            const burst: unknown = limit[key];
            if (!(typeof burst === "number" && Number.isInteger(burst) && burst > 0))
                report(
                    `${where}.${key} ${JSON.stringify(burst)} is not a whole number of bytes above 0: RFC 2698 needs a burst for each rate`
                );
        }
        if (!limit.exceed || typeof limit.exceed !== "object")
            report(`${where} has no exceed: write { dscp: "af12" }, the DSCP of what passes between cir and pir`);
    }

    private static limit(where: string, limit: Limit | TwoRateLimit, report: Report): void {
        if (Derive.isTwoRate(limit)) return RateLimitChecks.twoRate(where, limit, report);
        if (typeof limit === "object" && (limit.be !== undefined || limit.exceed !== undefined))
            return report(`${where} has be or exceed without pir: write pir, the peak rate, or leave them out`);

        const { rate, burst } = Derive.limit(limit);
        RateLimitChecks.rate(where, rate, report);
        if (burst !== undefined && !(Number.isInteger(burst) && burst > 0))
            report(`${where}.bc ${burst} is not a whole number of bytes above 0`);
    }
}
