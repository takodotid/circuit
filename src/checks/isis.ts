import { Derive } from "../core/derive";
import type { Device, Isis } from "../model";

type Report = (message: string) => void;

/** IS-IS as ISO/IEC 10589 and RFC 5305 allow it. */
export class IsisChecks {
    /** OpenConfig's `net` type with the selector 00: the area, then a system ID of three groups of four hex digits. */
    private static readonly NET = /^[0-9a-f]{2}(\.[0-9a-f]{4}){3,9}\.00$/i;
    /** The largest wide metric of a link that SPF uses: one of 2^24 - 1 takes the link out (RFC 5305). */
    private static readonly MAX_METRIC = 16_777_214;
    /** The levels each level capability runs, as `levels` names them. */
    private static readonly LEVELS: Record<Isis["level_capability"], readonly string[]> = {
        "level-1": ["1"],
        "level-2": ["2"],
        "level-1-2": ["1", "2"],
    };

    static check(device: Device, report: Report): void {
        const isis = device.routing?.isis;
        if (!isis) return;

        if (!IsisChecks.NET.test(isis.net))
            report(
                `routing.isis.net is '${isis.net}': write the area, the system ID of three groups of four hex digits, and 00, such as 49.0001.0102.5500.1001.00`
            );

        if (!isis.address_families.length) report("routing.isis.address_families is empty: write ipv4, ipv6, or both");

        for (const [level, settings] of Object.entries(isis.levels ?? {})) {
            const at = `routing.isis.levels.${level}`;
            if (!IsisChecks.LEVELS[isis.level_capability].includes(level))
                report(`${at}: level_capability is ${isis.level_capability}, so the device doesn't run level ${level}. Remove it`);
            if (settings?.authentication && isis.authentication)
                report(`${at}.authentication: routing.isis.authentication signs every level already. Remove one of them`);
        }

        for (const [name, settings] of Object.entries(isis.interfaces)) {
            const at = `routing.isis.interfaces.${name}`;
            const metric = settings?.metric;
            if (metric !== undefined && !(Number.isInteger(metric) && metric >= 1 && metric <= IsisChecks.MAX_METRIC))
                report(`${at}.metric is ${metric}: write a whole number from 1 to ${IsisChecks.MAX_METRIC}`);

            const vrf = Derive.settings(device, name)?.vrf;
            if (vrf)
                report(`${at}: ${name} routes in VRF ${vrf}, and IS-IS runs in the main table. Remove it from routing.isis.interfaces`);
        }
    }
}
