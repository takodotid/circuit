import type { Device, RouteMatch } from "../model";

type Report = (message: string) => void;

/** Why a policy may only pick prefixes: what it can't match, and why it sets nothing. */
type Reasons = { match: string; set: string };

/** A policy that picks prefixes and changes nothing, such as LDP's label policies and IS-IS's leaking between levels. */
export class PrefixPolicyChecks {
    /** What such a policy's rules match. */
    static readonly MATCHES: readonly string[] = ["family", "prefix", "prefix_set", "prefix_length"] satisfies (keyof RouteMatch)[];

    /** The policy `name`, and each one it calls, matches prefixes only and sets nothing. `at` is where the config names it. */
    static check(device: Device, at: string, name: string, reasons: Reasons, report: Report, seen = new Set<string>()): void {
        if (seen.has(name)) return;
        seen.add(name);

        (device.routing?.policies?.[name] ?? []).forEach((rule, index) => {
            if (rule.call !== undefined) return PrefixPolicyChecks.check(device, at, rule.call, reasons, report, seen);
            if (rule.communities !== undefined) return;

            const where = `${at}: routing.policies.${name}[${index}]`;
            const other = Object.keys(rule.if ?? {}).filter((key) => !PrefixPolicyChecks.MATCHES.includes(key));
            if (other.length)
                report(`${where}.if has ${other.join(", ")}, and ${reasons.match}. Match ${PrefixPolicyChecks.MATCHES.join(", ")}`);
            if (rule.set) report(`${where}.set, and ${reasons.set}. Remove set, and write then: "accept" or "reject"`);
        });
    }
}
