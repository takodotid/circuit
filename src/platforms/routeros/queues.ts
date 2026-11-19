import { Derive } from "../../core/derive";
import type { Device, Rate, Switched } from "../../model";
import type { RouterOsRender } from "./render";

/** Rate limits, as simple queues. */
export class RouterOsQueues {
    /** A queue's bucket, as a share of its rate, when no burst is set. */
    private static readonly BUCKET_SIZE = "0.1";
    /** A queue's bucket is a share of its rate in steps of a thousandth, up to `MAX_BUCKET` times the rate. */
    private static readonly BUCKET_STEPS = 1000;
    private static readonly MAX_BUCKET = 10;

    /**
     * A simple queue on each interface with a rate limit. Its target is the interface: what arrives on it is what the target sends, the first of each pair, and what leaves is the second. A rate of 0 is no limit.
     */
    static render(render: RouterOsRender, device: Device): void {
        for (const { name, rateLimit } of Derive.rateLimited(device)) {
            const limits = [rateLimit.input, rateLimit.output].map((limit) => (limit ? Derive.limit(limit) : undefined));
            const bursts = limits.some((limit) => limit?.burst !== undefined);
            const target = render.name(name);

            render.add("/queue simple", "add", {
                "bucket-size": bursts && limits.map((limit) => RouterOsQueues.bucketSize(limit)).join("/"),
                "max-limit": limits.map((limit) => (limit ? RouterOsQueues.rate(Derive.bitsPerSecond(limit.rate)) : "0")).join("/"),
                name: `${target}-rate-limit`,
                target,
            });
        }
    }

    /**
     * A simple queue limits what the CPU forwards: a flow on the fast path, or routed by the switch chip, skips it (MikroTik's manual, Simple queue). On a bridge port it limits nothing the router routes (TRAPS.md). A burst is the queue's bucket, a share of the rate in thousandths. A switch rule has no burst.
     */
    static unsupported(device: Device): string[] {
        const found: string[] = [];
        const fastPath = Object.values(device.firewall?.filter ?? {}).some((chain) => chain?.rules?.some((rule) => rule.fast_path));

        for (const { where, kind, name, rateLimit } of Derive.rateLimited(device)) {
            const switched = kind === "vlan_interface" ? undefined : (device.interfaces?.[kind]?.[name] as Switched | undefined);
            if (switched?.access_vlan || switched?.trunk_vlans || switched?.qinq_vlan)
                found.push(
                    `${where}.rate_limit on a switched port or LAG, whose queue sees nothing the router routes: limit the VLAN interface`
                );
            if (fastPath) found.push(`${where}.rate_limit beside a fast_path rule, whose flows skip the queue`);
            const software = kind === "vlan_interface" && device.interfaces?.vlan_interface?.[name]?.hardware_offload === false;
            if (device.system?.hardware_offload && !software)
                found.push(
                    `${where}.rate_limit while system.hardware_offload is on, whose traffic skips the queue: limit a VLAN interface with hardware_offload: false`
                );

            for (const direction of ["input", "output"] as const) {
                const limit = rateLimit[direction];
                const { rate, burst } = limit ? Derive.limit(limit) : {};
                if (rate === undefined || burst === undefined) continue;

                const { BUCKET_STEPS, MAX_BUCKET } = RouterOsQueues;
                const steps = RouterOsQueues.bucketSteps(rate, burst);
                if (Number.isInteger(steps) && steps <= MAX_BUCKET * BUCKET_STEPS) continue;
                const step = Derive.bitsPerSecond(rate) / Derive.BITS_PER_BYTE / BUCKET_STEPS;
                found.push(
                    `${where}.rate_limit.${direction}.bc ${burst}, the platform's burst is a share of the rate in thousandths, up to ${MAX_BUCKET} times it: at ${rate}, a multiple of ${step} bytes up to ${step * MAX_BUCKET * BUCKET_STEPS}`
                );
            }
        }

        for (const [name, rules] of Object.entries(device.switching?.acls ?? {}))
            (rules ?? []).forEach((rule, index) => {
                if (rule.rate && Derive.limit(rule.rate).burst !== undefined)
                    found.push(
                        `switching.acls.${name}[${index}].rate.bc, a switch rule takes a rate without a burst: write the rate alone`
                    );
            });

        return found;
    }

    /** A rate as the platform prints it, in the largest unit that keeps a whole number: `1500M` for `1.5G` (TRAPS.md). */
    private static rate(bits: number): string {
        const units = Object.entries(Derive.RATE_UNITS).reverse();
        const [unit, scale] = units.find(([, each]) => Number.isInteger(bits / each)) ?? ["", 1];
        return `${bits / scale}${unit}`;
    }

    /** A burst in bytes as steps of a queue's bucket: 250000 bytes at 200M is 10 steps, a bucket of 0.01 of the rate. */
    private static bucketSteps(rate: Rate, burst: number): number {
        return (burst * Derive.BITS_PER_BYTE * RouterOsQueues.BUCKET_STEPS) / Derive.bitsPerSecond(rate);
    }

    /** A queue's bucket as a share of its rate, 0.1 without a burst, the platform's default. */
    private static bucketSize(limit: { rate: Rate; burst?: number } | undefined): string {
        if (limit?.burst === undefined) return RouterOsQueues.BUCKET_SIZE;
        return String(Math.round(RouterOsQueues.bucketSteps(limit.rate, limit.burst)) / RouterOsQueues.BUCKET_STEPS);
    }
}
