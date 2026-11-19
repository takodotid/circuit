// Rate limits as shared traffic shapers, which shaping policies apply to the sessions through an interface. NP6 offload ignores an interface's own `inbandwidth` (#215).

import { Derive } from "../../core/derive";
import type { Device, Family, Limit } from "../../model";
import { FortiOsNames } from "./names";
import type { FortiOsNode } from "./tree";
import { FortiOsTree } from "./tree";

export class FortiOsShaping {
    /** The shapers every FortiGate on 6.2 is shipped with, which the plan leaves alone. */
    static readonly FACTORY_SHAPERS = ["high-priority", "medium-priority", "low-priority", "guarantee-100kbps", "shared-1M-pipe"];

    /** A shaper's units, largest first. `kbps` is the default, which the device does not print. */
    private static readonly UNITS: readonly (readonly [string, number])[] = [
        ["gbps", 1e9],
        ["mbps", 1e6],
        ["kbps", 1e3],
    ];
    private static readonly DEFAULT_UNIT = "kbps";

    /**
     * A shaper for each direction an interface limits, shared by every session it shapes. A session started on the interface's side shapes what it sends there with the input shaper, and its replies with the output shaper. A session started toward the interface does the reverse. Each family needs its own policies.
     */
    static render(root: FortiOsNode, device: Device): void {
        const shapers = root.block("firewall shaper traffic-shaper");
        const policies = root.block("firewall shaping-policy");
        let id = 0;

        for (const { name, rateLimit } of Derive.rateLimited(device)) {
            const iface = FortiOsNames.of(device, name);
            const input = rateLimit.input && FortiOsShaping.shaper(shapers, `rate-limit-${iface}-in`, rateLimit.input);
            const output = rateLimit.output && FortiOsShaping.shaper(shapers, `rate-limit-${iface}-out`, rateLimit.output);

            for (const family of ["ipv4", "ipv6"] as const) {
                const from = FortiOsShaping.policy(policies.entry(++id), `rate-limit-${iface}-from`, family, input, output);
                from.set("srcintf", FortiOsTree.quote(iface)).set("dstintf", FortiOsTree.quote("any"));
                const to = FortiOsShaping.policy(policies.entry(++id), `rate-limit-${iface}-to`, family, output, input);
                to.set("srcintf", FortiOsTree.quote("any")).set("dstintf", FortiOsTree.quote(iface));
            }
        }
    }

    /** What the platform can't shape: a burst, a rate of no whole kbit/s, an interface outside the root VDOM, and transparent mode, which is not tested. */
    static gaps(device: Device): string[] {
        const found: string[] = [];
        const management = new Set(device.system?.vdoms?.management?.interfaces ?? []);

        for (const { where, name, rateLimit } of Derive.rateLimited(device)) {
            if (FortiOsNames.isTransparent(device)) found.push(`${where}.rate_limit in transparent mode, which is not built yet`);
            if (management.has(name)) found.push(`${where}.rate_limit on an interface of the management VDOM, which is not built yet`);

            for (const direction of ["input", "output"] as const) {
                const limit = rateLimit[direction];
                if (!limit) continue;
                const { rate, burst } = Derive.limit(limit);
                if (burst !== undefined)
                    found.push(`${where}.rate_limit.${direction}.bc, a FortiGate's shaper takes no burst: write the rate alone`);
                if (!FortiOsShaping.bandwidth(Derive.bitsPerSecond(rate)))
                    found.push(`${where}.rate_limit.${direction}, the platform takes a rate in whole kbit/s`);
            }
        }

        return found;
    }

    /** A shared shaper, in the largest unit that keeps a whole number. */
    private static shaper(shapers: FortiOsNode, name: string, limit: Limit): string {
        const [unit, amount] = FortiOsShaping.bandwidth(Derive.bitsPerSecond(Derive.limit(limit).rate)) ?? [FortiOsShaping.DEFAULT_UNIT, 0];
        const entry = shapers.entry(name).set("maximum-bandwidth", amount);
        if (unit !== FortiOsShaping.DEFAULT_UNIT) entry.set("bandwidth-unit", unit);
        return name;
    }

    /** A rate as a unit and a whole number of it, or nothing below a whole kbit/s. */
    private static bandwidth(bits: number): readonly [string, number] | undefined {
        const unit = FortiOsShaping.UNITS.find(([, scale]) => Number.isInteger(bits / scale));
        return unit && [unit[0], bits / unit[1]];
    }

    /** A shaping policy of one family, for every address and service, with the shapers of its two directions. */
    private static policy(entry: FortiOsNode, name: string, family: Family, forward?: string, reverse?: string): FortiOsNode {
        const v6 = family === "ipv6";
        entry.set("name", FortiOsTree.quote(v6 ? `${name}-v6` : name));
        if (v6) entry.set("ip-version", 6);
        entry.set("service", FortiOsTree.quote("ALL"));
        entry.set(v6 ? "srcaddr6" : "srcaddr", FortiOsTree.quote("all")).set(v6 ? "dstaddr6" : "dstaddr", FortiOsTree.quote("all"));
        if (forward) entry.set("traffic-shaper", FortiOsTree.quote(forward));
        if (reverse) entry.set("traffic-shaper-reverse", FortiOsTree.quote(reverse));
        return entry;
    }
}
