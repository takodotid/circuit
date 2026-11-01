// How good the path to a device is, measured before an apply sends anything. A path that drops packets is how a change loses the device halfway.

import { spawn } from "node:child_process";
import { isIPv6 } from "node:net";

/** What the pings found: how many were sent, and the round trip of each that came back, in milliseconds. */
export type PathMeasure = { sent: number; times: number[] };

/** Whether an apply may go ahead over the path, and a line that says why. */
export type PathVerdict = { refuse: boolean; summary: string };

export class PathCheck {
    /** Pings sent in all. With 20, one lost is 5%. */
    static readonly PINGS = 20;

    /** Ping programs run side by side, so the check takes about five seconds on every system: each sends one ping a second. */
    private static readonly RUNS = 4;

    /** The most loss allowed, in percent: one of 20 pings may be lost, two may not. */
    static readonly MAX_LOSS_PERCENT = 5;

    /** The highest average round trip allowed, in milliseconds. */
    static readonly MAX_AVERAGE_MS = 300;

    /** How long one ping program may run before it is stopped and what it printed is counted. */
    private static readonly LIMIT_MS = 15_000;

    /**
     * The round trip of every reply in what `ping` printed, in milliseconds. A reply is the one line with a time after `=` or `<` and before `ms`, as in `time=12 ms` or `time<1ms`: the same in every language `ping` prints in. A summary line has several times, or none right before `ms`, and is not counted.
     */
    static parse(output: string): number[] {
        const times: number[] = [];

        for (const line of output.split(/\r?\n/)) {
            const found = [...line.matchAll(/[=<]\s*(\d+(?:[.,]\d+)?)\s*ms\b/gi)];
            if (found.length === 1) times.push(Number(found[0]![1]!.replace(",", ".")));
        }

        return times;
    }

    /** Whether the path is good enough to apply over. A device that answers no ping at all may only block it, so that alone is not refused. */
    static verdict(host: string, measure: PathMeasure): PathVerdict {
        const received = Math.min(measure.times.length, measure.sent);

        if (!received) return { refuse: false, summary: `${host} answers no ping, so the path to it was not measured` };

        const lost = measure.sent - received;
        const lossPercent = Math.round((lost / measure.sent) * 100);
        const average = Math.round(measure.times.reduce((sum, time) => sum + time, 0) / measure.times.length);
        const summary = `${host}: ${lost} of ${measure.sent} pings lost (${lossPercent}%), ${average} ms on average`;

        const refuse = lossPercent > PathCheck.MAX_LOSS_PERCENT || average > PathCheck.MAX_AVERAGE_MS;
        return { refuse, summary };
    }

    /** Ping a host with the system's `ping`. Undefined when there is no `ping` to run. */
    static async measure(host: string): Promise<PathMeasure | undefined> {
        const count = PathCheck.PINGS / PathCheck.RUNS;
        const outputs = await Promise.all(Array.from({ length: PathCheck.RUNS }, () => PathCheck.ping(host, count)));
        if (outputs.some((output) => output === undefined)) return undefined;

        // A duplicate reply is printed as a reply too; no run counts more replies than it sent.
        const times = outputs.flatMap((output) => PathCheck.parse(output!).slice(0, count));
        return { sent: PathCheck.PINGS, times };
    }

    /** What one run of `ping` printed. Windows takes `-n` and a wait per ping in milliseconds; Linux and macOS take `-c`, and macOS pings IPv6 with `ping6`. */
    private static ping(host: string, count: number): Promise<string | undefined> {
        const windows = process.platform === "win32";
        const program = !windows && process.platform === "darwin" && isIPv6(host) ? "ping6" : "ping";
        const args = windows ? ["-n", String(count), "-w", "1000", host] : ["-c", String(count), host];

        return new Promise((done) => {
            const child = spawn(program, args, { windowsHide: true });
            let output = "";

            const limit = setTimeout(() => child.kill(), PathCheck.LIMIT_MS);

            child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString("utf8")));
            child.on("error", () => {
                clearTimeout(limit);
                done(undefined);
            });
            child.on("close", () => {
                clearTimeout(limit);
                done(output);
            });
        });
    }
}
