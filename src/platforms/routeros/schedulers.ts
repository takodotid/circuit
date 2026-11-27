import { Derive } from "../../core/derive";
import type { Device, MarkingRule, Queue, Rate, Red, Switched } from "../../model";
import { RouterOsQueues } from "./queues";
import type { RouterOsRender, Value } from "./render";

/** Schedulers: a queue tree under `global` for each interface that takes one, fed by packet marks set in the mangle table. */
export class RouterOsSchedulers {
    private static readonly MANGLE = ["/ip firewall mangle", "/ipv6 firewall mangle"] as const;

    /** The HTB priority of a strict queue, the highest. A weighted queue keeps the lowest, 8, the default. */
    private static readonly STRICT_PRIORITY = 1;

    /** A share is a percent. */
    private static readonly PERCENT = 100;

    /** What a weighted queue is kept is rounded down to whole kbit/s, which RouterOS prints as written. */
    private static readonly STEP = 1000;

    /** RED counts its queue in bytes, each threshold times `red-avg-packet` (TRAPS.md). Circuit counts a packet as 1500 bytes, the most an Ethernet frame carries (RFC 894), so a queue of full packets holds `depth_packets`. */
    private static readonly RED_PACKET_BYTES = 1500;

    /** `red-burst` sets how fast the average of RED follows the queue, and RouterOS refuses one below the lower threshold. The guideline in Linux's tc-red manual is the lower threshold twice and the upper one once, over 3. */
    private static readonly RED_BURST_PARTS = 3;

    /**
     * What a routed packet's in-interface trusts, as a packet mark it takes in the forward chain before the marking rules. A marking rule's class replaces it. A packet the router sends itself takes none, and is sorted by its DSCP and PCP.
     */
    private static readonly TRUST = {
        none: "qos-trust-none",
        dscp: "qos-trust-dscp",
        pcp: "qos-trust-pcp",
        all: "qos-trust-dscp-pcp",
    } as const;

    /**
     * Each class's packets are marked as they leave the interface: by a marking rule's class, then by DSCP and by PCP where trusted (TRAPS.md). The first mark ends the chain. HTB serves every queue's `limit-at` first, then lends what is left by priority (MikroTik's manual, HTB). So a strict queue keeps its `max` at priority 1, and a weighted queue its share of what the strict queues' `max` leave.
     */
    static render(render: RouterOsRender, device: Device): void {
        const qos = device.qos;
        const fallback = qos?.default_class;
        if (!fallback || !RouterOsSchedulers.schedules(device)) return;

        // The default class takes the rest, so its own DSCPs and PCPs need no rule.
        const others = Object.entries(qos.classes ?? {}).filter(([each]) => each !== fallback);
        const listed = others.flatMap(([each, settings]) => (settings?.dscp ?? []).map((dscp) => ({ each, dscp: Derive.DSCP[dscp] })));
        const tagged = others.flatMap(([each, settings]) => (settings?.pcp ?? []).map((pcp) => ({ each, pcp })));
        // Each class a marking rule sets, once.
        const marked = [...new Set((qos.marking ?? []).flatMap((rule) => RouterOsSchedulers.markedClass(device, rule) ?? []))];

        // Trust matters only where a DSCP or a PCP picks a class.
        const trusts = listed.length + tagged.length > 0;
        const { TRUST } = RouterOsSchedulers;
        const used = new Set(trusts ? RouterOsSchedulers.trust(render, device) : []);
        const notPcpOnly = used.has(TRUST.pcp) ? `!${TRUST.pcp}` : undefined;
        const notDscpOnly = used.has(TRUST.dscp) ? `!${TRUST.dscp}` : undefined;

        for (const { name, scheduler: schedulerName } of Derive.scheduled(device)) {
            const scheduler = qos.schedulers?.[schedulerName];
            if (!scheduler?.rate) continue;

            const iface = render.name(name);
            const root = `${iface}-${schedulerName}`;
            const mark = (queue: string, match: Parameters<typeof RouterOsSchedulers.mark>[2] = {}) =>
                RouterOsSchedulers.mark(iface, `${root}-${queue}`, match);
            for (const menu of RouterOsSchedulers.MANGLE) {
                for (const each of marked) render.add(menu, "add", mark(each, { "packet-mark": each }));
                if (trusts) render.add(menu, "add", mark(fallback, { "packet-mark": TRUST.none }));
                for (const { each, dscp } of listed) render.add(menu, "add", mark(each, { dscp, "packet-mark": notPcpOnly }));
                for (const { each, pcp } of tagged)
                    render.add(menu, "add", mark(each, { "ingress-priority": pcp, "packet-mark": notDscpOnly }));
                render.add(menu, "add", mark(fallback));
            }
            RouterOsSchedulers.queues(render, root, scheduler.rate, scheduler.queues);
        }
    }

    /** Whether an interface takes a scheduler that the platform builds, one with a rate, so classes sort packets. */
    private static schedules(device: Device): boolean {
        return Derive.scheduled(device).some(({ scheduler }) => device.qos?.schedulers?.[scheduler]?.rate);
    }

    /**
     * The class a marking rule gives a packet here, as a packet mark of its name: its `class`, else the class that lists the DSCP it writes. A rule that writes a DSCP no class lists leaves the mark of what its in-interface trusts. Without a scheduler, no class is marked.
     */
    static markedClass(device: Device, rule: MarkingRule): string | undefined {
        if (rule.then.class !== undefined) return rule.then.class;
        const dscp = rule.then.dscp;
        if (dscp === undefined || !device.qos?.default_class || !RouterOsSchedulers.schedules(device)) return undefined;
        return Object.entries(device.qos.classes ?? {}).find(([, settings]) => settings?.dscp?.includes(dscp))?.[0];
    }

    /**
     * Marks each routed packet in the forward chain with what its in-interface trusts, and every other routed packet with trusting nothing. It returns the marks it wrote. The marking rules come after these in the forward chain (`RouterOsFirewall`), as this renders first.
     */
    private static trust(render: RouterOsRender, device: Device): string[] {
        const { TRUST } = RouterOsSchedulers;
        const trusting = Derive.trusting(device).map(({ name, trust }) => {
            const dscp = trust.includes("dscp");
            const pcp = trust.includes("pcp");
            return { iface: render.name(name), mark: dscp && pcp ? TRUST.all : dscp ? TRUST.dscp : TRUST.pcp };
        });

        for (const menu of RouterOsSchedulers.MANGLE) {
            for (const { iface, mark } of trusting)
                render.add(menu, "add", { action: "mark-packet", chain: "forward", "in-interface": iface, "new-packet-mark": mark });
            render.add(menu, "add", { action: "mark-packet", chain: "forward", "new-packet-mark": TRUST.none, "packet-mark": "no-mark" });
        }
        return [...trusting.map(({ mark }) => mark), TRUST.none];
    }

    /** A mangle rule that marks what leaves `iface` for `queue`, by its DSCP, its ingress priority, or its mark when given, its properties in the order the device exports them. */
    private static mark(
        iface: string,
        queue: string,
        match: { dscp?: number; "ingress-priority"?: number; "packet-mark"?: string } = {}
    ): Record<string, Value> {
        return {
            action: "mark-packet",
            chain: "postrouting",
            dscp: match.dscp,
            "ingress-priority": match["ingress-priority"],
            "new-packet-mark": queue,
            "out-interface": iface,
            "packet-mark": match["packet-mark"],
            passthrough: "no",
        };
    }

    /** The scheduler's queue, `root`, at its rate, and a queue under it for each class, marked with its own name. A queue with a depth takes a queue type of its own name. */
    private static queues(render: RouterOsRender, root: string, rate: Rate, queues: readonly Queue[]): void {
        const { STEP, PERCENT } = RouterOsSchedulers;
        const bits = Derive.bitsPerSecond(rate);
        const strict = queues.reduce((sum, queue) => sum + (queue.max ? Derive.bitsPerSecond(queue.max) : 0), 0);

        render.add("/queue tree", "add", { "max-limit": RouterOsQueues.rate(bits), name: root, parent: "global" });
        for (const queue of queues) {
            const leaf = `${root}-${queue.class}`;
            const max = queue.max ? Derive.bitsPerSecond(queue.max) : undefined;
            const kept = max ?? Math.floor(((queue.share ?? 0) * (bits - strict)) / PERCENT / STEP) * STEP;
            const type = RouterOsSchedulers.type(leaf, queue);
            if (type) render.add("/queue type", "add", type);
            render.add("/queue tree", "add", {
                "limit-at": RouterOsQueues.rate(kept),
                "max-limit": RouterOsQueues.rate(max ?? bits),
                name: leaf,
                "packet-mark": leaf,
                parent: root,
                priority: queue.priority === "strict" ? RouterOsSchedulers.STRICT_PRIORITY : undefined,
                queue: type ? leaf : undefined,
            });
        }
    }

    /** A queue's depth as a FIFO of that many packets, which drops at its tail, or as RED with its thresholds in whole packets. Without a depth, the queue keeps `default-small`. */
    private static type(name: string, queue: Queue): Record<string, Value> | undefined {
        const depth = queue.depth_packets;
        if (depth === undefined) return undefined;
        if (!queue.red) return { kind: "pfifo", name, "pfifo-limit": depth };

        const { min, max } = RouterOsSchedulers.thresholds(depth, queue.red);
        return {
            kind: "red",
            name,
            "red-avg-packet": RouterOsSchedulers.RED_PACKET_BYTES,
            "red-burst": Math.ceil((min + min + max) / RouterOsSchedulers.RED_BURST_PARTS),
            "red-limit": depth,
            "red-max-threshold": max,
            "red-min-threshold": min,
        };
    }

    /** The thresholds of RED in whole packets of `depth`, rounded down. */
    private static thresholds(depth: number, red: Red): { min: number; max: number } {
        const packets = (percent: number) => Math.floor((depth * percent) / RouterOsSchedulers.PERCENT);
        return { min: packets(red.min_threshold_percent), max: packets(red.max_threshold_percent) };
    }

    /**
     * What the queues would miss or can't do. A flow on the fast path skips the mangle table and the queues under `global` (MikroTik's manual, Queue tree). So does what the switch chip routes with hardware offload on. On a switched port, routed packets leave through the VLAN interface, which the marks match.
     */
    static unsupported(device: Device): string[] {
        const found: string[] = [];
        const scheduled = Derive.scheduled(device);
        const used = new Set(scheduled.map(({ scheduler }) => scheduler));

        for (const [name, scheduler] of Object.entries(device.qos?.schedulers ?? {})) {
            if (!scheduler || !used.has(name)) continue;
            if (scheduler.rate === undefined)
                found.push(
                    `qos.schedulers.${name} without rate: RouterOS holds packets in the queues only when more comes than a rate. Write rate, a little below the speed of each interface that takes it`
                );
            scheduler.queues.forEach((queue, index) => {
                if (queue.priority === "strict" && queue.max === undefined)
                    found.push(
                        `qos.schedulers.${name}.queues[${index}] strict without max: RouterOS sends a queue first only up to a rate it keeps for it. Write max, the most the class may send`
                    );
                const depth = queue.depth_packets;
                if (depth === undefined || !queue.red) return;
                const { min, max } = RouterOsSchedulers.thresholds(depth, queue.red);
                if (min >= max && queue.red.min_threshold_percent < queue.red.max_threshold_percent)
                    found.push(
                        `qos.schedulers.${name}.queues[${index}].red: of ${depth} packets, both thresholds come to ${max} whole packets, and RouterOS needs the lower one below the other. Set them further apart, or deepen the queue`
                    );
            });
        }

        // A routed packet's in-interface is the VLAN interface it arrives through, not the bridge port.
        for (const { where, kind, name } of Derive.trusting(device)) {
            const switched = kind === "vlan_interface" ? undefined : (device.interfaces?.[kind]?.[name] as Switched | undefined);
            if (switched?.access_vlan || switched?.trunk_vlans || switched?.qinq_vlan)
                found.push(
                    `${where}.qos_trust on a switched port or LAG, whose routed packets arrive through a VLAN interface: write it there`
                );
        }

        const fastPath = Object.values(device.firewall?.filter ?? {}).some((chain) => chain?.rules?.some((rule) => rule.fast_path));
        for (const { where, kind, name } of scheduled) {
            const switched = kind === "vlan_interface" ? undefined : (device.interfaces?.[kind]?.[name] as Switched | undefined);
            if (switched?.access_vlan || switched?.trunk_vlans || switched?.qinq_vlan)
                found.push(
                    `${where}.scheduler on a switched port or LAG, whose routed packets leave through a VLAN interface: write it there`
                );
            if (fastPath)
                found.push(
                    `${where}.scheduler beside a fast_path rule, whose flows skip the mangle table and the queues: take fast_path off`
                );
            const software = kind === "vlan_interface" && device.interfaces?.vlan_interface?.[name]?.hardware_offload === false;
            if (device.system?.hardware_offload && !software)
                found.push(
                    `${where}.scheduler while system.hardware_offload is on, whose routed traffic skips the queues: schedule a VLAN interface with hardware_offload: false`
                );
        }

        return found;
    }
}
