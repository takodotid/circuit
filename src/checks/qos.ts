import { closest } from "../config/keys";
import { Derive } from "../core/derive";
import type { Device, Port, Queue, Scheduler } from "../model";
import { RateLimitChecks } from "./rate-limit";

type Report = (message: string) => void;

/** Marking rules write a DSCP by its IANA name, an IEEE 802.1Q priority, or a class. Classes split the DSCPs between them, and each scheduler has a queue for each class, with a depth and the thresholds of RED in whole numbers. */
export class QosChecks {
    /** The highest PCP, three bits (IEEE 802.1Q). */
    private static readonly MAX_PCP = 7;

    /** A share is a percent, and the shares of a scheduler add up to all of it. */
    private static readonly PERCENT = 100;

    static check(device: Device, report: Report): void {
        (device.qos?.marking ?? []).forEach((rule, index) => {
            const where = `qos.marking[${index}]`;
            const then: unknown = rule.then;

            if (!then || typeof then !== "object")
                report(
                    `${where}.then ${JSON.stringify(then)} is no marking: write it as { dscp: "ef" }, { pcp: 5 }, { class: "voice" }, or several`
                );
            else if (rule.then.dscp === undefined && rule.then.pcp === undefined && rule.then.class === undefined)
                report(`${where}.then marks nothing: write dscp, pcp, class, or several`);
            else {
                if (rule.then.dscp !== undefined) QosChecks.dscp(`${where}.then.dscp`, rule.then.dscp, report);
                const pcp = rule.then.pcp;
                if (pcp !== undefined && !(Number.isInteger(pcp) && pcp >= 0 && pcp <= QosChecks.MAX_PCP))
                    report(`${where}.then.pcp ${pcp} is not a whole number from 0 to ${QosChecks.MAX_PCP}`);
            }

            const matched = rule.if?.dscp;
            if (Array.isArray(matched) && !matched.length)
                report(`${where}.if.dscp is an empty list, which matches no packet: leave it out`);
            for (const dscp of [matched ?? []].flat()) QosChecks.dscp(`${where}.if.dscp`, dscp, report);
        });

        QosChecks.classes(device, report);
        for (const [name, scheduler] of Object.entries(device.qos?.schedulers ?? {}))
            if (scheduler) QosChecks.scheduler(device, name, scheduler, report);
        QosChecks.scheduled(device, report);
    }

    /** Each DSCP is in one class at most, and the default class takes the rest. A scheduler's queues hold classes. */
    private static classes(device: Device, report: Report): void {
        const qos = device.qos;
        const names = Object.keys(qos?.classes ?? {});
        if (names.length && qos?.default_class === undefined)
            report(`qos.classes without default_class: write the class of every DSCP no class lists, one of ${names.join(", ")}`);
        if (!names.length && Object.keys(qos?.schedulers ?? {}).length)
            report("qos.schedulers without classes: write qos.classes, the classes their queues hold");

        const owner = new Map<string, string>();
        for (const [name, settings] of Object.entries(qos?.classes ?? {})) {
            const where = `qos.classes.${name}.dscp`;
            const dscps: unknown = settings?.dscp;
            if (!Array.isArray(dscps) || !dscps.length) {
                report(`${where} lists no DSCP: write at least one, such as ["ef"]`);
                continue;
            }

            for (const dscp of dscps as unknown[]) {
                QosChecks.dscp(where, dscp, report);
                const first = owner.get(String(dscp));
                if (first === undefined) owner.set(String(dscp), name);
                else report(`${where}: ${String(dscp)} is in qos.classes.${first} too. A DSCP is in one class at most`);
            }
        }
    }

    /**
     * One queue for each class. A queue is strict, with a `max` at most the rate, or weighted, with a whole percent. The shares add up to 100, and the strict queues' `max` leave the weighted queues something.
     */
    private static scheduler(device: Device, name: string, scheduler: Scheduler, report: Report): void {
        const where = `qos.schedulers.${name}`;
        const rate =
            scheduler.rate !== undefined && RateLimitChecks.rate(`${where}.rate`, scheduler.rate, report) ? scheduler.rate : undefined;
        const queues: unknown = scheduler.queues;
        if (!Array.isArray(queues) || !queues.length) {
            report(`${where}.queues is empty: write one queue for each class`);
            return;
        }

        const seen = new Set<string>();
        let shares = 0;
        let weighted = 0;
        let strictBits = 0;
        scheduler.queues.forEach((queue, index) => {
            const at = `${where}.queues[${index}]`;
            QosChecks.management(at, queue, report);
            if (seen.has(queue.class)) report(`${at}.class ${queue.class} has a queue already: write one queue for each class`);
            seen.add(queue.class);

            const priority: unknown = queue.priority;
            if (priority !== undefined) {
                if (priority !== "strict")
                    report(`${at}.priority ${JSON.stringify(priority)} is not one: write "strict", or a share instead`);
                if (queue.share !== undefined)
                    report(`${at} has both priority and share: a strict queue has no share, so write one of them`);
                if (queue.max === undefined || !RateLimitChecks.rate(`${at}.max`, queue.max, report)) return;
                strictBits += Derive.bitsPerSecond(queue.max);
                if (rate !== undefined && Derive.bitsPerSecond(queue.max) > Derive.bitsPerSecond(rate))
                    report(`${at}.max ${queue.max} is above the scheduler's rate, ${rate}: write ${rate} or less`);
                return;
            }

            if (queue.share === undefined) {
                report(`${at} is neither strict nor weighted: write priority: "strict", or a share`);
                return;
            }
            weighted++;
            if (Number.isInteger(queue.share) && queue.share >= 1 && queue.share <= QosChecks.PERCENT) shares += queue.share;
            else report(`${at}.share ${queue.share} is not a whole percent from 1 to ${QosChecks.PERCENT}`);
        });

        const missing = Object.keys(device.qos?.classes ?? {}).filter((each) => !seen.has(each));
        if (missing.length) report(`${where}.queues has no queue for ${missing.join(", ")}: write one for each class, so none is left out`);
        if (weighted && shares !== QosChecks.PERCENT) report(`${where}.queues: the shares add up to ${shares}. Make them add up to 100`);
        if (weighted && rate !== undefined && strictBits >= Derive.bitsPerSecond(rate))
            report(
                `${where}: the strict queues' max add up to the rate, ${rate}, or more, which leaves the weighted queues nothing. Lower a max, or raise the rate`
            );
    }

    /** A queue's depth is a whole number of packets. The thresholds of RED are whole percents of it, the lower one first. */
    private static management(at: string, queue: Queue, report: Report): void {
        const depth = queue.depth_packets;
        if (depth !== undefined && !(Number.isInteger(depth) && depth >= 1))
            report(`${at}.depth_packets ${depth} is not a whole number of packets above 0`);

        const red: unknown = queue.red;
        if (red === undefined) return;
        if (!red || typeof red !== "object") {
            report(`${at}.red ${JSON.stringify(red)} is no RED: write it as { min_threshold_percent: 20, max_threshold_percent: 80 }`);
            return;
        }
        if (depth === undefined) report(`${at}.red without depth_packets: write the queue's depth, which the thresholds are percents of`);

        const { min_threshold_percent: min, max_threshold_percent: max } = queue.red!;
        const whole = (value: number) => Number.isInteger(value) && value >= 0 && value <= QosChecks.PERCENT;
        for (const [key, value] of [
            ["min_threshold_percent", min],
            ["max_threshold_percent", max],
        ] as const)
            if (!whole(value)) report(`${at}.red.${key} ${value} is not a whole percent from 0 to ${QosChecks.PERCENT}`);
        if (whole(min) && whole(max) && min >= max)
            report(`${at}.red.min_threshold_percent ${min} is not below max_threshold_percent, ${max}: lower it, or raise the other`);
    }

    /** A scheduler is the one thing that shapes what leaves an interface, on the LAG rather than its members. */
    private static scheduled(device: Device, report: Report): void {
        for (const { where, kind, name } of Derive.scheduled(device)) {
            const settings = device.interfaces?.[kind]?.[name] as Pick<Port, "shaping" | "rate_limit"> | undefined;
            if (settings?.shaping)
                report(
                    `${where}.scheduler beside shaping, which also shapes what leaves: write the scheduler's rate, and leave shaping out`
                );
            const output = settings?.rate_limit && Derive.limitsOutput(settings.rate_limit);
            if (output)
                report(`${where}.scheduler beside rate_limit.${output}, which also limits what leaves: write the scheduler's rate instead`);
            const lag = kind === "ethernet" ? device.interfaces?.ethernet?.[name]?.in_lag : undefined;
            if (lag) report(`${where}.scheduler is on a member of ${lag}: write it on the LAG`);
        }
    }

    private static dscp(where: string, value: unknown, report: Report): void {
        const names = Object.keys(Derive.DSCP);
        if (typeof value === "string" && names.includes(value)) return;

        const hint = typeof value === "string" ? closest(value.toLowerCase(), names) : undefined;
        report(`${where} ${JSON.stringify(value)} is no DSCP name. ${hint ? `Did you mean ${hint}?` : `It takes: ${names.join(", ")}.`}`);
    }
}
