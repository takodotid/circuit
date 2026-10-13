// The 95th percentile as the lesson "What an ISP sells" explains it: sort the five-minute samples, throw away the busiest 5 percent, and bill the highest one left.

/** Traffic on a transit port in one evening, one sample every five minutes from 18:00, in Mbit/s. Made up for the lesson. */
export const EVENING: readonly number[] = [
    148, 152, 160, 171, 180, 192, 205, 214, 221, 230, 236, 242, 247, 251, 258, 262, 255, 249, 240, 233, 226, 219, 212, 204, 198, 190, 183,
    175, 170, 166, 161, 157, 153, 150, 146, 143, 140, 138, 135, 132,
];

/** Where the burst the reader adds begins, as a sample number counted from 0, and how fast it runs. */
export const BURST_START = 30;
export const BURST_RATE = 600;

/** The samples with a burst of `length` five-minute samples at `rate` written over them from `start`. */
export function withBurst(samples: readonly number[], length: number, start = BURST_START, rate = BURST_RATE): number[] {
    return samples.map((sample, index) => (index >= start && index < start + length ? rate : sample));
}

export type Percentile = {
    /** Each sample's place in time, sorted from the busiest down. */
    order: number[];
    /** How many of the busiest samples are thrown away: 5 percent of them, rounded down. */
    discarded: number;
    /** The time place of the sample that is billed. */
    billedIndex: number;
    /** The rate that is billed. */
    billed: number;
};

/** Sort from the busiest down, throw away the busiest 5 percent, and bill the highest sample left. */
export function percentile95(samples: readonly number[]): Percentile {
    if (samples.length === 0) throw new Error("No samples to bill.");

    // A sort that keeps equal samples in time order, so the drawing never jumps between two equal bars.
    const order = samples.map((_, index) => index).sort((a, b) => samples[b]! - samples[a]! || a - b);
    const discarded = Math.floor(samples.length * 0.05);
    const billedIndex = order[discarded]!;

    return { order, discarded, billedIndex, billed: samples[billedIndex]! };
}

/** What a commit and a 95th percentile make: the commit is always paid, and anything above it is burst. */
export function bill(billed: number, commit: number) {
    return { paidFor: Math.max(billed, commit), burst: Math.max(0, billed - commit), unused: Math.max(0, commit - billed) };
}
