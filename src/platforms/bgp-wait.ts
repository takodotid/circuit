// Waiting for BGP sessions to be established, for `circuit bgp --wait`.

import { setTimeout as sleep } from "node:timers/promises";
import type { BgpSession } from "./platform";

/** How long to wait, and how often to read again, both in seconds. */
export type WaitLimits = { seconds: number; every: number };

export class BgpWait {
    /** `circuit bgp --wait` reads the sessions again every 15 seconds, for at most 600 seconds unless `--max` says otherwise. */
    static readonly COMMAND: WaitLimits = { seconds: 600, every: 15 };

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
}
