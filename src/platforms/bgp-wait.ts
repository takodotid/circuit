import { setTimeout as sleep } from "node:timers/promises";
import type { BgpSession } from "./platform";

/** How long to wait, and how often to read again, both in seconds. */
export type WaitLimits = { seconds: number; every: number };

export class BgpWait {
    /** For `circuit bgp --wait`, whose `--max` sets `seconds`. */
    static readonly COMMAND: WaitLimits = { seconds: 600, every: 15 };

    /** A session reset by a change opens again when one side retries. Three minutes leaves room for a slow peer without holding the apply up for long. A session that never went down is seen at the first read, so a healthy apply doesn't wait. */
    static readonly AFTER_APPLY: WaitLimits = { seconds: 180, every: 10 };

    /** Sessions closed on their limit within this many minutes of each other are one burst. */
    static readonly BURST_MINUTES = 5;

    private static readonly SECOND_MS = 1000;
    private static readonly MINUTE_MS = 60_000;

    /** Read until `enough` holds or time runs out, and give the last read. `waiting` is told of each read that fell short, before the pause. */
    static async until<T>(
        read: () => Promise<T>,
        enough: (value: T) => boolean,
        limits: WaitLimits,
        waiting: (value: T) => void = () => {}
    ): Promise<T> {
        const deadline = Date.now() + limits.seconds * BgpWait.SECOND_MS;
        let value = await read();

        while (!enough(value) && Date.now() < deadline) {
            waiting(value);
            await sleep(Math.min(limits.every * BgpWait.SECOND_MS, Math.max(0, deadline - Date.now())));
            value = await read();
        }

        return value;
    }

    static upCount(sessions: readonly BgpSession[]): number {
        return sessions.filter((session) => session.established).length;
    }

    /** Groups of two or more sessions closed on their limit within `BURST_MINUTES` of each other, earliest first. Several limits at once is usually a leak upstream, not growth, so raising them is the wrong fix. */
    static limitBursts(sessions: readonly BgpSession[]): BgpSession[][] {
        const closed = sessions
            .filter((session) => session.limit?.stoppedAt !== undefined && !Number.isNaN(session.limit.stoppedAt))
            .sort((a, b) => a.limit!.stoppedAt! - b.limit!.stoppedAt!);

        const bursts: BgpSession[][] = [];
        for (const session of closed) {
            const last = bursts.at(-1);
            const previous = last?.at(-1);
            if (last && previous && session.limit!.stoppedAt! - previous.limit!.stoppedAt! <= BgpWait.BURST_MINUTES * BgpWait.MINUTE_MS)
                last.push(session);
            else bursts.push([session]);
        }

        return bursts.filter((burst) => burst.length > 1);
    }
}
