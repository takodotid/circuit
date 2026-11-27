import { Derive } from "../../core/derive";
import type { Device, PerPrefix, Rate, Switched } from "../../model";
import type { RouterOsRender } from "./render";

/** Rate limits, as simple queues. */
export class RouterOsQueues {
    /** A queue's bucket, as a share of its rate, when no burst is set. */
    private static readonly BUCKET_SIZE = "0.1";
    /** A queue's bucket is a share of its rate in steps of a thousandth, up to `MAX_BUCKET` times the rate. */
    private static readonly BUCKET_STEPS = 1000;
    private static readonly MAX_BUCKET = 10;
    /** The queue type of a simple queue's direction that sets none, a FIFO of 10 packets. */
    private static readonly SMALL_FIFO = "default-small";

    /**
     * A simple queue on each interface with a rate limit. Its target is the interface: what arrives on it is what the target sends, the first of each pair, and what leaves is the second. A rate of 0 is no limit, and `max-limit` holds the interface as a whole.
     */
    static render(render: RouterOsRender, device: Device): void {
        for (const { name, rateLimit } of Derive.rateLimited(device)) {
            const target = render.name(name);
            // Two rates are refused in `unsupported()`.
            const limits = [rateLimit.input, rateLimit.output].map((limit) => {
                const one = Derive.oneRate(limit);
                return one && Derive.limit(one);
            });
            const whole = limits.some(Boolean);
            const bursts = limits.some((limit) => limit?.burst !== undefined);
            const queue = rateLimit.per_prefix && RouterOsQueues.perPrefix(render, target, rateLimit.per_prefix);

            render.add("/queue simple", "add", {
                "bucket-size": bursts && limits.map((limit) => RouterOsQueues.bucketSize(limit)).join("/"),
                "max-limit":
                    whole && limits.map((limit) => (limit ? RouterOsQueues.rate(Derive.bitsPerSecond(limit.rate)) : "0")).join("/"),
                name: `${target}-rate-limit`,
                queue,
                target,
            });
        }
    }

    /**
     * A rate for each prefix is a PCQ queue type, which gives each source or destination prefix a queue of its own at `pcq-rate` (MikroTik's manual, PCQ). What arrives on the interface is sorted by its source, and what leaves by its destination, each family by its own mask. It returns the simple queue's queue types, upload first, with `default-small` for a direction without a rate.
     */
    private static perPrefix(render: RouterOsRender, target: string, perPrefix: PerPrefix): string {
        const types = (["input", "output"] as const).map((direction) => {
            const rate = perPrefix[direction];
            if (!rate) return RouterOsQueues.SMALL_FIFO;

            const name = `${target}-rate-limit-${direction}`;
            const side = direction === "input" ? "src" : "dst";
            render.add("/queue type", "add", {
                kind: "pcq",
                name,
                "pcq-classifier": `${side}-address`,
                "pcq-rate": RouterOsQueues.rate(Derive.bitsPerSecond(rate)),
                [`pcq-${side}-address-mask`]: perPrefix.ipv4,
                [`pcq-${side}-address6-mask`]: perPrefix.ipv6,
            });
            return name;
        });
        return types.join("/");
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
                if (limit && Derive.isTwoRate(limit))
                    found.push(
                        `${where}.rate_limit.${direction}, two rates: RouterOS has no policer with two rates (RFC 2698). A queue shapes, and the firewall's limit matcher polices one rate (TRAPS.md). Write one rate`
                    );
                const one = Derive.oneRate(limit);
                const { rate, burst } = one ? Derive.limit(one) : {};
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
    static rate(bits: number): string {
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
