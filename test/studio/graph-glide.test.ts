// How the graph glides: eased from where things are to where they go, on frames that a test gives, so a late frame never makes it jump.

import { describe, expect, test } from "bun:test";
import { type GlideOptions, GraphGlide } from "../../src/studio/app/src/lib/graph-glide";

/** A glide on frames the test gives: each call to `at` runs the next frame at that time. */
function glide(options: GlideOptions = {}) {
    const steps: number[] = [];
    let next: ((now: number) => void) | undefined;
    let done = false;
    const running = new GraphGlide(
        (t) => steps.push(t),
        (frame) => (next = frame),
        { ...options, done: () => (done = true) }
    );

    const at = (now: number) => {
        const frame = next;
        next = undefined;
        frame?.(now);
    };
    return { running, steps, at, done: () => done };
}

describe("a glide", () => {
    test("starts where things are, eases, and ends where they go", () => {
        const { steps, at, done } = glide();
        for (let now = 0; now <= GraphGlide.TIME + 20; now += 10) at(now);

        expect(steps[0]).toBe(0);
        expect(steps.at(-1)).toBe(1);
        expect(done()).toBe(true);
        for (const [index, t] of steps.entries()) if (index) expect(t).toBeGreaterThanOrEqual(steps[index - 1]!);

        // Slow at first, quick in the middle.
        expect(steps[1]! - steps[0]!).toBeLessThan(steps[41]! - steps[40]!);
    });

    test("a frame that comes late counts as one frame, so the glide goes on from where it was", () => {
        const { steps, at } = glide();
        at(0);
        at(16);
        at(32);
        at(32 + 2000);

        const late = GraphGlide.EASE_IN_OUT((32 + GraphGlide.LONGEST_FRAME) / GraphGlide.TIME);
        expect(steps.at(-1)).toBeCloseTo(late, 6);
        expect(steps.at(-1)).toBeLessThan(0.01);
    });

    test("stops where it is, and does not finish", () => {
        const { running, steps, at, done } = glide();
        at(0);
        at(100);
        running.stop();
        at(200);

        expect(steps).toHaveLength(2);
        expect(done()).toBe(false);
    });

    test("takes the time it is given", () => {
        const { steps, at, done } = glide({ time: 100, easing: GraphGlide.SINE });
        for (let now = 0; now <= 100; now += 25) at(now);

        expect(steps).toEqual([0, 0.25, 0.5, 0.75, 1].map(GraphGlide.SINE));
        expect(done()).toBe(true);
    });
});

describe("the view between two views", () => {
    test("zooms evenly, and moves the point in the middle of the canvas in a straight line", () => {
        const size = { width: 800, height: 600 };
        const from = { zoom: 0.5, pan: { x: 100, y: 40 } };
        const to = { zoom: 2, pan: { x: -300, y: 200 } };
        const middle = (view: typeof from) => ({ x: (400 - view.pan.x) / view.zoom, y: (300 - view.pan.y) / view.zoom });

        expect(GraphGlide.viewBetween(from, to, 0, size)).toEqual(from);
        expect(GraphGlide.viewBetween(from, to, 1, size).zoom).toBeCloseTo(to.zoom, 9);
        expect(GraphGlide.viewBetween(from, to, 0.5, size).zoom).toBeCloseTo(1, 9);

        for (const t of [0.25, 0.5, 1]) {
            const now = middle(GraphGlide.viewBetween(from, to, t, size));
            expect(now.x).toBeCloseTo(middle(from).x + (middle(to).x - middle(from).x) * t, 9);
            expect(now.y).toBeCloseTo(middle(from).y + (middle(to).y - middle(from).y) * t, 9);
        }
    });
});
