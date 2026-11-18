// How the graph glides, on frames that a test gives. A late frame never makes it jump. A glide eases from where things are to where they go. A glide that replaces another starts at the speed things already have.

import { describe, expect, test } from "bun:test";
import { GraphGlide } from "../../src/studio/app/src/lib/graph-glide";
import type { GlideOptions, Motion } from "../../src/studio/app/src/lib/graph-glide";

/** A glide on frames the test gives: each call to `at` runs the next frame at that time. */
function glide(options: GlideOptions = {}) {
    const shares: number[] = [];
    let next: ((now: number) => void) | undefined;
    let done = false;
    const running = new GraphGlide(
        (s) => shares.push(s),
        (frame) => (next = frame),
        { ...options, done: () => (done = true) }
    );

    const at = (now: number) => {
        const frame = next;
        next = undefined;
        frame?.(now);
    };
    return { running, shares, at, done: () => done };
}

const TIME = GraphGlide.TIME;
const point = (x: number, y: number) => ({ x, y, z: 0 });

describe("a glide's time", () => {
    test("goes from 0 to 1 over the glide's time, then the glide is done", () => {
        const { running, shares, at, done } = glide();
        for (let now = 0; now <= TIME; now += 20) at(now);

        expect(shares.slice(0, 3)).toEqual([0, 20 / TIME, 40 / TIME]);
        expect(shares.at(-1)).toBe(1);
        expect(running.share).toBe(1);
        expect(done()).toBe(true);
    });

    test("a frame that comes late counts as one frame, so the glide goes on from where it was", () => {
        const { shares, at } = glide();
        at(0);
        at(16);
        at(16 + 2000);

        expect(shares.at(-1)).toBeCloseTo((16 + GraphGlide.LONGEST_FRAME) / TIME, 9);
    });

    test("stops where it is, and does not finish", () => {
        const { running, shares, at, done } = glide();
        at(0);
        at(100);
        running.stop();
        at(200);

        expect(shares).toHaveLength(2);
        expect(done()).toBe(false);
    });

    test("goes on from the last frame of the glide it replaces, so its first frame moves too", () => {
        const { shares, at } = glide({ since: 1000 });
        at(1016);

        expect(shares).toEqual([16 / TIME]);
    });

    test("takes the time it is given", () => {
        const { shares, at } = glide({ time: 100 });
        at(0);
        at(25);

        expect(shares).toEqual([0, 0.25]);
    });
});

describe("a motion", () => {
    test("from rest: slow at both ends, quick in the middle, and at rest where it goes", () => {
        const motion: Motion = { from: point(0, 0), to: point(100, -50), speed: GraphGlide.AT_REST };

        expect(GraphGlide.at(motion, 0, TIME)).toEqual(point(0, 0));
        expect(GraphGlide.at(motion, 0.5, TIME)).toEqual(point(50, -25));
        expect(GraphGlide.at(motion, 1, TIME)).toEqual(point(100, -50));
        expect(GraphGlide.speedAt(motion, 0, TIME)).toEqual(GraphGlide.AT_REST);
        expect(GraphGlide.speedAt(motion, 1, TIME).x).toBeCloseTo(0, 9);
        expect(GraphGlide.at(motion, 0.1, TIME).x).toBeLessThan(GraphGlide.at(motion, 0.55, TIME).x - GraphGlide.at(motion, 0.45, TIME).x);
    });

    test("a glide that replaces another starts at its speed, then comes to rest where it goes", () => {
        const first: Motion = { from: point(0, 0), to: point(300, 0), speed: GraphGlide.AT_REST };
        const halfway = 0.4;
        const next: Motion = {
            from: GraphGlide.at(first, halfway, TIME),
            to: point(0, 200),
            speed: GraphGlide.speedAt(first, halfway, TIME),
        };

        expect(GraphGlide.speedAt(next, 0, TIME)).toEqual(GraphGlide.speedAt(first, halfway, TIME));
        expect(GraphGlide.at(next, 1, TIME).x).toBeCloseTo(0, 9);
        expect(GraphGlide.at(next, 1, TIME).y).toBeCloseTo(200, 9);
        expect(GraphGlide.speedAt(next, 1, TIME).x).toBeCloseTo(0, 9);
    });

    test("its speed is how fast its place changes, per millisecond", () => {
        const motion: Motion = { from: point(10, 0), to: point(-90, 40), speed: point(0.5, -0.2) };
        for (const s of [0.1, 0.3, 0.5, 0.8]) {
            const step = 1e-6;
            const ahead = GraphGlide.at(motion, s + step, TIME);
            const behind = GraphGlide.at(motion, s - step, TIME);
            const speed = GraphGlide.speedAt(motion, s, TIME);
            expect(speed.x).toBeCloseTo((ahead.x - behind.x) / (2 * step * TIME), 5);
            expect(speed.y).toBeCloseTo((ahead.y - behind.y) / (2 * step * TIME), 5);
        }
    });
});

describe("a view's place", () => {
    test("is the point in the middle of the canvas and the zoom's logarithm, so a view halfway is zoomed halfway evenly", () => {
        const size = { width: 800, height: 600 };
        const from = { zoom: 0.5, pan: { x: 100, y: 40 } };
        const to = { zoom: 2, pan: { x: -300, y: 200 } };

        const back = GraphGlide.viewAt(GraphGlide.placeOf(from, size), size);
        expect(back.zoom).toBeCloseTo(from.zoom, 9);
        expect(back.pan.x).toBeCloseTo(from.pan.x, 9);
        expect(back.pan.y).toBeCloseTo(from.pan.y, 9);

        const motion: Motion = { from: GraphGlide.placeOf(from, size), to: GraphGlide.placeOf(to, size), speed: GraphGlide.AT_REST };
        expect(GraphGlide.viewAt(GraphGlide.at(motion, 0.5, TIME), size).zoom).toBeCloseTo(1, 9);
    });
});
