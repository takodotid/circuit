import { Derive } from "../core/derive";
import type { Device, Limit } from "../model";

type Report = (message: string) => void;

/** Rate limits as RFC 2697 has them: a rate above 0, and a burst of whole bytes. */
export class RateLimitChecks {
    /** A rate: a number, then `k`, `M`, or `G`. */
    private static readonly RATE = /^(\d+(\.\d+)?)[kMG]$/;

    /** Each rate limit limits something, on the LAG rather than its members. CAKE's shaping already limits what leaves. */
    static check(device: Device, report: Report): void {
        for (const { where, kind, name, rateLimit } of Derive.rateLimited(device)) {
            if (!rateLimit.input && !rateLimit.output) report(`${where}.rate_limit limits nothing: write input, output, or both`);
            for (const direction of ["input", "output"] as const) {
                const limit = rateLimit[direction];
                if (limit) RateLimitChecks.limit(`${where}.rate_limit.${direction}`, limit, report);
            }

            const lag = kind === "ethernet" ? device.interfaces?.ethernet?.[name]?.in_lag : undefined;
            if (lag) report(`${where}.rate_limit is on a member of ${lag}: write it on the LAG`);
            if (rateLimit.output && Derive.settings(device, name)?.shaping)
                report(`${where}.rate_limit.output beside shaping, which also limits what leaves: write one of them`);
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

    private static limit(where: string, limit: Limit, report: Report): void {
        const { rate, burst } = Derive.limit(limit);
        RateLimitChecks.rate(where, rate, report);
        if (burst !== undefined && !(Number.isInteger(burst) && burst > 0))
            report(`${where}.bc ${burst} is not a whole number of bytes above 0`);
    }
}
