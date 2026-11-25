// Classes and marking are shaping policies, which give each session a class and a DSCP. A scheduler is a shaping profile, which queues each class on the interfaces that take it (decision 226).

import { Derive } from "../../core/derive";
import type { Device, Dscp, Family, MarkingRule, Queue, Scheduler } from "../../model";
import { FortiOsFirewall } from "./firewall";
import { FortiOsNames } from "./names";
import { FortiOsTree } from "./tree";
import type { FortiOsNode } from "./tree";

export class FortiOsQos {
    /** The settings of an interface that a scheduler sets. They point to a VDOM's shaping profile, so the plan changes them after the VDOMs make their profiles and before they delete them. */
    static readonly INTERFACE_SETTINGS = ["outbandwidth", "egress-shaping-profile"] as const;

    /** `firewall traffic-class` takes class IDs from 2 to 31 on 6.2.2. */
    private static readonly CLASS_IDS = { first: 2, last: 31 };

    /** A traffic class's, a shaping profile's, and a shaping policy's name holds 35 characters, and a service's 79. */
    private static readonly NAME_LENGTH = 35;
    private static readonly SERVICE_LENGTH = 79;

    /** A queue of a shaping profile of `type queuing` holds 5 to 10000 packets, 1000 when nothing says. */
    static readonly DEPTH = { min: 5, max: 10_000, default: 1000 };

    /** An interface's `outbandwidth` is in kbit/s, up to 16776000. */
    private static readonly KBPS = { bits: 1000, max: 16_776_000 };

    private static readonly PERCENT = 100;

    /** A DSCP is the six high bits of the ToS byte (RFC 2474), which a shaping policy compares under this mask. */
    private static readonly DSCP_MASK = "0xfc";
    private static readonly DSCP_SHIFT = 2;
    private static readonly DSCP_BITS = 6;
    private static readonly HEX = 16;

    /** A strict queue takes the highest of 6.2's five priorities, and a weighted queue the lowest, as on RouterOS. */
    private static readonly PRIORITY = { strict: "top", weighted: "low" } as const;

    /** The suffix of a shaping policy for IPv6. */
    private static readonly V6 = "-v6";

    /** Each class of `qos.classes` by its ID, in the order the config lists them. */
    static classIds(device: Device): Map<string, number> {
        const names = Object.keys(device.qos?.classes ?? {});
        return new Map(names.map((name, index) => [name, FortiOsQos.CLASS_IDS.first + index]));
    }

    /**
     * The device sorts a session by its first packet, and the first shaping policy that matches gives it a class and a DSCP. So the marking rules come first, each with the class of the DSCP it sets, then a policy for each DSCP a class lists. A session no policy matches takes `default_class`, each profile's `default-class-id`.
     */
    static render(root: FortiOsNode, device: Device): void {
        const qos = device.qos;
        const ids = FortiOsQos.classIds(device);
        if (!qos || (!qos.marking && !ids.size)) return;

        for (const [name, id] of ids) root.block("firewall traffic-class").entry(id).set("class-name", FortiOsTree.quote(name));

        const policies = root.block("firewall shaping-policy");
        const objects = FortiOsFirewall.objects(root, device);
        let id = policies.entries.size;

        (qos.marking ?? []).forEach((rule, index) => {
            for (const family of FortiOsFirewall.familiesOf(device, rule.if)) {
                const entry = FortiOsQos.policy(policies.entry(++id), `marking-${index + 1}`, family);
                FortiOsQos.marking(entry, objects, device, rule, family, ids);
            }
        });

        for (const [name, settings] of Object.entries(qos.classes ?? {})) {
            if (name === qos.default_class) continue;

            for (const dscp of settings?.dscp ?? [])
                for (const family of ["ipv4", "ipv6"] as const) {
                    const entry = FortiOsQos.policy(policies.entry(++id), `${name}-${dscp}`, family);
                    entry.set("srcintf", FortiOsTree.quote("any")).set("dstintf", FortiOsTree.quote("any"));
                    entry.set(family === "ipv6" ? "srcaddr6" : "srcaddr", FortiOsTree.quote("all"));
                    entry.set(family === "ipv6" ? "dstaddr6" : "dstaddr", FortiOsTree.quote("all"));
                    entry.set("service", FortiOsTree.quote(objects.service(undefined, family)));
                    FortiOsQos.tos(entry, dscp);
                    entry.set("class-id", ids.get(name)!);
                }
        }

        const used = new Set<string>();
        for (const { name, scheduler } of Derive.scheduled(device)) {
            const settings = qos.schedulers?.[scheduler];
            if (!settings?.rate || !qos.default_class) continue;

            if (!used.has(scheduler))
                FortiOsQos.profile(root.block("firewall shaping-profile").entry(scheduler), settings, ids, qos.default_class);
            used.add(scheduler);

            root.block("system interface")
                .entry(FortiOsNames.of(device, name))
                .set("outbandwidth", Derive.bitsPerSecond(settings.rate) / FortiOsQos.KBPS.bits)
                .set("egress-shaping-profile", FortiOsTree.quote(scheduler));
        }
    }

    /**
     * What the platform can't build: classes by PCP, a PCP, RED, and a scheduler outside the root VDOM, beside hardware offload, or in transparent mode. A session takes one shaping policy, so none beside rate limits, which use them too. A scheduler needs its rate, and each strict queue its `max`, in whole percents of the rate.
     */
    static gaps(device: Device): string[] {
        const found: string[] = [];
        const qos = device.qos;
        const classes = Object.entries(qos?.classes ?? {});
        const scheduled = Derive.scheduled(device);
        const sorts = Boolean(qos?.marking?.length) || scheduled.length > 0;

        if (sorts && device.system?.hardware_offload)
            found.push(
                "system.hardware_offload beside qos.marking or a scheduler: on 6.2 an offloaded session skips the egress shaping profile (Fortinet bug 469798), and no offloaded session was seen marked. Write system.hardware_offload: false, which writes auto-asic-offload disable on each policy that accepts, or leave qos out"
            );
        if (sorts)
            (device.firewall?.filter?.forward?.rules ?? []).forEach((rule, index) => {
                if (rule.fast_path)
                    found.push(
                        `firewall.filter.forward.rules[${index}].fast_path beside qos.marking or a scheduler: its sessions are offloaded, and skip both on 6.2 (Fortinet bug 469798). Leave fast_path out`
                    );
            });
        if (sorts && FortiOsNames.isTransparent(device)) found.push("qos in transparent mode, which is not built yet");
        if (qos?.marking?.length || classes.length)
            for (const { where } of Derive.rateLimited(device))
                found.push(
                    `${where}.rate_limit beside qos.marking or qos.classes: FortiOS gives a session one shaping policy, and both need it. Write a scheduler's rate instead`
                );

        const longest = FortiOsQos.NAME_LENGTH - FortiOsQos.V6.length;
        if (classes.length > FortiOsQos.CLASS_IDS.last - FortiOsQos.CLASS_IDS.first + 1)
            found.push(`qos.classes, at most ${FortiOsQos.CLASS_IDS.last - FortiOsQos.CLASS_IDS.first + 1} on FortiOS 6.2`);
        for (const [name, settings] of classes) {
            if (settings?.pcp)
                found.push(
                    `qos.classes.${name}.pcp, FortiOS 6.2's shaping policies match no PCP: list the DSCPs the class's packets carry`
                );
            const dscp = (settings?.dscp ?? []).find((each) => `${name}-${each}`.length > longest);
            if (dscp)
                found.push(`qos.classes.${name}, a name of ${longest - dscp.length - 1} characters at most beside ${dscp} on FortiOS`);
        }

        (qos?.marking ?? []).forEach((rule, index) => {
            const where = `qos.marking[${index}]`;
            if (rule.then.pcp !== undefined) found.push(`${where}.then.pcp, FortiOS 6.2 sets a PCP only in a firewall policy: set a DSCP`);
            if (!FortiOsFirewall.familiesOf(device, rule.if).length) found.push(`${where}, its addresses share no family`);
            for (const family of FortiOsFirewall.familiesOf(device, rule.if))
                if (FortiOsFirewall.serviceOf(rule.if, family).name.length > FortiOsQos.SERVICE_LENGTH)
                    found.push(`${where}.if ports, too many for one service`);
        });

        const management = new Set(device.system?.vdoms?.management?.interfaces ?? []);
        for (const { where, name } of scheduled)
            if (management.has(name)) found.push(`${where}.scheduler on an interface of the management VDOM, which is not built yet`);

        const used = new Set(scheduled.map(({ scheduler }) => scheduler));
        for (const [name, scheduler] of Object.entries(qos?.schedulers ?? {}))
            if (scheduler && used.has(name)) found.push(...FortiOsQos.schedulerGaps(`qos.schedulers.${name}`, name, scheduler));

        return found;
    }

    private static schedulerGaps(where: string, name: string, scheduler: Scheduler): string[] {
        const found: string[] = [];
        const { KBPS, PERCENT, DEPTH } = FortiOsQos;

        if (name.length > FortiOsQos.NAME_LENGTH) found.push(`${where}, a name of ${FortiOsQos.NAME_LENGTH} characters at most on FortiOS`);
        if (!scheduler.rate) {
            found.push(`${where} without rate: FortiOS shares out an interface's outbandwidth, so write the rate`);
            return found;
        }

        const bits = Derive.bitsPerSecond(scheduler.rate);
        if (!Number.isInteger(bits / KBPS.bits) || bits / KBPS.bits > KBPS.max)
            found.push(`${where}.rate, FortiOS takes whole kbit/s up to ${KBPS.max}k`);

        scheduler.queues.forEach((queue, index) => {
            const at = `${where}.queues[${index}]`;
            if (queue.red)
                found.push(`${at}.red, FortiOS's RED needs a drop probability, which Circuit has no key for: write depth_packets alone`);
            const depth = queue.depth_packets;
            if (depth !== undefined && (depth < DEPTH.min || depth > DEPTH.max))
                found.push(`${at}.depth_packets, FortiOS takes ${DEPTH.min} to ${DEPTH.max} packets`);

            if (queue.priority === "strict" && !queue.max)
                found.push(`${at} without max: FortiOS keeps a strict queue its max, so write it`);
            if (queue.max && !Number.isInteger((Derive.bitsPerSecond(queue.max) * PERCENT) / bits))
                found.push(`${at}.max, FortiOS takes a whole percent of the scheduler's rate, ${scheduler.rate}`);
        });

        for (const [index, percents] of FortiOsQos.percents(scheduler).entries())
            if (percents && scheduler.queues[index]?.share !== undefined && !percents.guaranteed)
                found.push(
                    `${where}.queues[${index}].share, less than 1% of the rate once the strict queues have theirs: FortiOS keeps whole percents`
                );

        return found;
    }

    /** Each queue's guaranteed and largest part of the rate, in whole percents. A strict queue's `max` is both. A weighted queue keeps its share of what the strict queues leave, rounded down, and may take all of the rate. */
    private static percents(scheduler: Scheduler): ({ guaranteed: number; maximum: number } | undefined)[] {
        const { PERCENT } = FortiOsQos;
        if (!scheduler.rate) return [];

        const bits = Derive.bitsPerSecond(scheduler.rate);
        const strict = (queue: Queue) => (queue.max ? Math.round((Derive.bitsPerSecond(queue.max) * PERCENT) / bits) : 0);
        const left = PERCENT - scheduler.queues.reduce((sum, queue) => sum + strict(queue), 0);

        return scheduler.queues.map((queue) => {
            if (queue.priority === "strict") return { guaranteed: strict(queue), maximum: strict(queue) };
            return { guaranteed: Math.floor(((queue.share ?? 0) * left) / PERCENT), maximum: PERCENT };
        });
    }

    /** A scheduler as a profile that queues, with a shaping entry for each queue. */
    private static profile(entry: FortiOsNode, scheduler: Scheduler, ids: Map<string, number>, fallback: string): void {
        entry.set("type", "queuing").set("default-class-id", ids.get(fallback)!);
        const entries = entry.block("shaping-entries");
        const percents = FortiOsQos.percents(scheduler);

        scheduler.queues.forEach((queue, index) => {
            const shares = percents[index]!;
            const shaping = entries.entry(index + 1);
            shaping.set("class-id", ids.get(queue.class)!);
            shaping.set("priority", queue.priority === "strict" ? FortiOsQos.PRIORITY.strict : FortiOsQos.PRIORITY.weighted);
            shaping.set("guaranteed-bandwidth-percentage", shares.guaranteed);
            shaping.set("maximum-bandwidth-percentage", shares.maximum);
            if (queue.depth_packets !== undefined) shaping.set("limit", queue.depth_packets);
        });
    }

    /** A shaping policy of one family, named. */
    private static policy(entry: FortiOsNode, name: string, family: Family): FortiOsNode {
        entry.set("name", FortiOsTree.quote(family === "ipv6" ? `${name}${FortiOsQos.V6}` : name));
        if (family === "ipv6") entry.set("ip-version", 6);
        return entry;
    }

    /** A marking rule's match, the DSCP it sets, and the class of the packets it marks. */
    private static marking(
        entry: FortiOsNode,
        objects: ReturnType<typeof FortiOsFirewall.objects>,
        device: Device,
        rule: MarkingRule,
        family: Family,
        ids: Map<string, number>
    ): void {
        const match = rule.if;
        const v6 = family === "ipv6";

        if (rule.description) entry.set("comment", FortiOsTree.quote(rule.description));
        entry.set("srcintf", FortiOsFirewall.interfaceOf(device, FortiOsNames.single(match?.in_interface)));
        entry.set("dstintf", FortiOsFirewall.interfaceOf(device, FortiOsNames.single(match?.out_interface)));
        entry.set(
            v6 ? "srcaddr6" : "srcaddr",
            FortiOsTree.quote(objects.address(FortiOsNames.single(match?.src), match?.src_address_set, family))
        );
        entry.set(
            v6 ? "dstaddr6" : "dstaddr",
            FortiOsTree.quote(objects.address(FortiOsNames.single(match?.dst), match?.dst_address_set, family))
        );
        entry.set("service", FortiOsTree.quote(objects.service(match, family)));

        const arrives = FortiOsNames.single(match?.dscp);
        if (arrives) FortiOsQos.tos(entry, arrives);

        const { dscp, class: named } = rule.then;
        if (dscp) {
            const value = Derive.DSCP[dscp].toString(2).padStart(FortiOsQos.DSCP_BITS, "0");
            entry.set("diffserv-forward", "enable").set("diffservcode-forward", value);
        }

        // A packet a rule marks takes the class of the DSCP it leaves with, or else `default_class`, the profile's own.
        const sorted =
            named ?? Object.entries(device.qos?.classes ?? {}).find(([, settings]) => dscp && settings?.dscp?.includes(dscp))?.[0];
        const id = sorted === undefined ? undefined : ids.get(sorted);
        if (id !== undefined) entry.set("class-id", id);
    }

    /** A DSCP match: the mask first, as the device drops a `tos` set before it. */
    private static tos(entry: FortiOsNode, dscp: Dscp): void {
        const tos = (Derive.DSCP[dscp] << FortiOsQos.DSCP_SHIFT).toString(FortiOsQos.HEX).padStart(2, "0");
        entry.set("tos-mask", FortiOsQos.DSCP_MASK).set("tos", `0x${tos}`);
    }
}
