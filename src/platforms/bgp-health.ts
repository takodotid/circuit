import type { Device } from "../model";
import { BgpWait } from "./bgp-wait";
import type { WaitLimits } from "./bgp-wait";
import type { HealthCheck, HealthOptions, Platform, ReadOptions, ReadSession } from "./platform";

/** The BGP part of the checks after an apply, alike on every platform that reads BGP sessions: each session established before must be established again. */
export class BgpHealth {
    /** The checks of a platform whose only check is BGP. The sessions established now are read before the plan is sent. */
    static async check(platform: Platform, device: Device, options: HealthOptions = {}): Promise<HealthCheck> {
        const limits = options.bgp ?? BgpWait.AFTER_APPLY;
        const establishedBefore = await BgpHealth.established(platform, device, options);

        return {
            run: async () => {
                if (!establishedBefore.length) {
                    console.log("  nothing to check: no BGP session was established before");
                    return [];
                }

                const session = await platform.session(device, options);

                try {
                    return await BgpHealth.back(platform, device, session, establishedBefore, limits);
                } finally {
                    session.close();
                }
            },
        };
    }

    /** The names of the configured neighbors whose session is established now. None, without logging in, on a device without BGP neighbors. */
    static async established(platform: Platform, device: Device, options: ReadOptions): Promise<string[]> {
        if (!platform.bgpSessions || !Object.keys(device.routing?.bgp?.neighbors ?? {}).length) return [];

        const session = await platform.session(device, options);

        try {
            const sessions = await platform.bgpSessions(device, session);
            return sessions.filter((bgp) => bgp.established).map((bgp) => bgp.neighbor);
        } finally {
            session.close();
        }
    }

    /** Wait until every one of these neighbors is established again, and give a problem for each that is not when time runs out. */
    static async back(
        platform: Platform,
        device: Device,
        session: ReadSession,
        neighbors: readonly string[],
        limits: WaitLimits
    ): Promise<string[]> {
        if (!neighbors.length || !platform.bgpSessions) return [];

        console.log(`  BGP: ${neighbors.length} session(s) were established before; waiting up to ${limits.seconds} s for them`);

        const read = async () => (await platform.bgpSessions!(device, session)).filter((bgp) => neighbors.includes(bgp.neighbor));
        const after = await BgpWait.until(
            read,
            (sessions) => BgpWait.upCount(sessions) === neighbors.length,
            limits,
            (sessions) =>
                console.log(
                    `  BGP: ${BgpWait.upCount(sessions)}/${neighbors.length} established again, checking again in ${limits.every} s`
                )
        );

        const down = after.filter((bgp) => !bgp.established);
        if (!down.length) {
            console.log(`  BGP: all ${neighbors.length} established again`);
            return [];
        }

        // A platform without --clear-limit or --log is pointed at what it has.
        const clear = (neighbor: string) =>
            platform.bgpClearLimit
                ? `circuit bgp ${device.name} --neighbors '^${neighbor}$' --clear-limit`
                : "clear the session on the device";
        const look = `circuit bgp ${device.name}${platform.bgpLog ? " --log" : ""}`;

        return down.map((bgp) =>
            bgp.limit
                ? `BGP session ${bgp.neighbor} was established before the apply and closed on its limit${bgp.limit.max !== undefined ? ` of ${bgp.limit.max} prefixes` : ""}: the neighbor sends more than it may. Find out why, then: ${clear(bgp.neighbor)}`
                : `BGP session ${bgp.neighbor} was established before the apply and is not ${limits.seconds} s after it (${bgp.reason ?? (bgp.uptime === "no session" ? "no session" : "not established")}). Look with: ${look}`
        );
    }
}
