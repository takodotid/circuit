import { Derive } from "../../core/derive";
import type { Device, Queue, Rate, Switched } from "../../model";
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

    /**
     * Each class's packets are marked as they leave the interface, by their DSCP, after `qos.marking` in the forward chain. The first mark ends the chain, and the default class takes the rest. HTB serves every queue's `limit-at` first, then lends what is left by priority (MikroTik's manual, HTB). So a strict queue keeps its `max` at priority 1, and a weighted queue its share of what the strict queues' `max` leave.
     */
    static render(render: RouterOsRender, device: Device): void {
        const qos = device.qos;
        const fallback = qos?.default_class;
        if (!fallback) return;

        // Each DSCP a class lists, with its class. The default class takes the rest, so its own DSCPs need no rule.
        const listed = Object.entries(qos.classes ?? {}).flatMap(([each, settings]) =>
            each === fallback ? [] : (settings?.dscp ?? []).map((dscp) => ({ each, dscp: Derive.DSCP[dscp] }))
        );

        for (const { name, scheduler: schedulerName } of Derive.scheduled(device)) {
            const scheduler = qos.schedulers?.[schedulerName];
            if (!scheduler?.rate) continue;

            const iface = render.name(name);
            const root = `${iface}-${schedulerName}`;
            for (const menu of RouterOsSchedulers.MANGLE) {
                for (const { each, dscp } of listed) render.add(menu, "add", RouterOsSchedulers.mark(iface, `${root}-${each}`, dscp));
                render.add(menu, "add", RouterOsSchedulers.mark(iface, `${root}-${fallback}`));
            }
            RouterOsSchedulers.queues(render, root, scheduler.rate, scheduler.queues);
        }
    }

    /** A mangle rule that marks what leaves `iface` for `queue`, with `dscp` when given, its properties in the order the device exports them. */
    private static mark(iface: string, queue: string, dscp?: number): Record<string, Value> {
        return { action: "mark-packet", chain: "postrouting", dscp, "new-packet-mark": queue, "out-interface": iface, passthrough: "no" };
    }

    /** The scheduler's queue, `root`, at its rate, and a queue under it for each class, marked with its own name. */
    private static queues(render: RouterOsRender, root: string, rate: Rate, queues: readonly Queue[]): void {
        const { STEP, PERCENT } = RouterOsSchedulers;
        const bits = Derive.bitsPerSecond(rate);
        const strict = queues.reduce((sum, queue) => sum + (queue.max ? Derive.bitsPerSecond(queue.max) : 0), 0);

        render.add("/queue tree", "add", { "max-limit": RouterOsQueues.rate(bits), name: root, parent: "global" });
        for (const queue of queues) {
            const leaf = `${root}-${queue.class}`;
            const max = queue.max ? Derive.bitsPerSecond(queue.max) : undefined;
            const kept = max ?? Math.floor(((queue.share ?? 0) * (bits - strict)) / PERCENT / STEP) * STEP;
            render.add("/queue tree", "add", {
                "limit-at": RouterOsQueues.rate(kept),
                "max-limit": RouterOsQueues.rate(max ?? bits),
                name: leaf,
                "packet-mark": leaf,
                parent: root,
                priority: queue.priority === "strict" ? RouterOsSchedulers.STRICT_PRIORITY : undefined,
            });
        }
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
            });
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
