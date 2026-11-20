import { closest } from "../config/keys";
import { Derive } from "../core/derive";
import type { Device } from "../model";

type Report = (message: string) => void;

/** Marking rules write a DSCP by its IANA name, or an IEEE 802.1Q priority. */
export class QosChecks {
    /** The highest PCP, three bits (IEEE 802.1Q). */
    private static readonly MAX_PCP = 7;

    static check(device: Device, report: Report): void {
        (device.qos?.marking ?? []).forEach((rule, index) => {
            const where = `qos.marking[${index}]`;
            const then: unknown = rule.then;

            if (!then || typeof then !== "object")
                report(`${where}.then ${JSON.stringify(then)} is no marking: write it as { dscp: "ef" }, { pcp: 5 }, or both`);
            else if (rule.then.dscp === undefined && rule.then.pcp === undefined)
                report(`${where}.then marks nothing: write dscp, pcp, or both`);
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
    }

    private static dscp(where: string, value: unknown, report: Report): void {
        const names = Object.keys(Derive.DSCP);
        if (typeof value === "string" && names.includes(value)) return;

        const hint = typeof value === "string" ? closest(value.toLowerCase(), names) : undefined;
        report(`${where} ${JSON.stringify(value)} is no DSCP name. ${hint ? `Did you mean ${hint}?` : `It takes: ${names.join(", ")}.`}`);
    }
}
