// BGP sessions as `circuit bgp` and the check after an apply read them: waiting for them to be established, and spotting limits that closed several at once.

import { setTimeout as sleep } from "node:timers/promises";
import type { BgpSession } from "./platform";

/** How long to wait, and how often to read again, both in seconds. */
export type WaitLimits = { seconds: number; every: number };

export class BgpWait {
    /** `circuit bgp --wait` reads the sessions again every 15 seconds, for at most 600 seconds unless `--max` says otherwise. */
    static readonly COMMAND: WaitLimits = { seconds: 600, every: 15 };

    /**
     * After an apply, the sessions established before have 180 seconds to be established again, read every 10 seconds. A session reset by a change opens again when one side retries; three minutes leaves room for a slow peer without holding the apply up for long. A session that never went down is seen at the first read, so a healthy apply does not wait.
     */
    static readonly AFTER_APPLY: WaitLimits = { seconds: 180, every: 10 };

    /** Read the sessions until `enough` holds or time runs out, and give the last read. `waiting` is told of each read that fell short, before the pause. */
    static async until(
        read: () => Promise<BgpSession[]>,
        enough: (sessions: BgpSession[]) => boolean,
        limits: WaitLimits,
        waiting: (sessions: BgpSession[]) => void = () => {}
    ): Promise<BgpSession[]> {
        const deadline = Date.now() + limits.seconds * 1000;
        let sessions = await read();

        while (!enough(sessions) && Date.now() < deadline) {
            waiting(sessions);
            await sleep(Math.min(limits.every * 1000, Math.max(0, deadline - Date.now())));
            sessions = await read();
        }

        return sessions;
    }

    /** How many of these sessions are established. */
    static upCount(sessions: readonly BgpSession[]): number {
        return sessions.filter((session) => session.established).length;
    }

    /** Sessions closed on their limit within this many minutes of each other are one burst. */
    static readonly BURST_MINUTES = 5;

    /**
     * Groups of two or more sessions closed on their limit within `BURST_MINUTES` of each other, earliest first. Several limits at once is usually a leak upstream, not growth, so raising them is the wrong fix.
     */
    static limitBursts(sessions: readonly BgpSession[]): BgpSession[][] {
        const closed = sessions
            .filter((session) => session.limit?.stoppedAt !== undefined && !Number.isNaN(session.limit.stoppedAt))
            .sort((a, b) => a.limit!.stoppedAt! - b.limit!.stoppedAt!);

        const bursts: BgpSession[][] = [];
        for (const session of closed) {
            const last = bursts.at(-1);
            const previous = last?.at(-1);
            if (last && previous && session.limit!.stoppedAt! - previous.limit!.stoppedAt! <= BgpWait.BURST_MINUTES * 60_000)
                last.push(session);
            else bursts.push([session]);
        }

        return bursts.filter((burst) => burst.length > 1);
    }
}
