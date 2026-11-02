// A packet travelling along a path in a widget's drawing: a point that moves from place to place at an even speed.
// With reduced motion it is shown at each place in turn instead of gliding.

import { onBeforeUnmount, ref } from "vue";

export type Point = [number, number];

export function useTravel(pixelsPerSecond = 260) {
    const position = ref<Point>([0, 0]);
    const travelling = ref(false);
    let frame = 0;

    onBeforeUnmount(() => cancelAnimationFrame(frame));

    /** Move along the points, and resolve when the last one is reached. */
    function travel(points: Point[]): Promise<void> {
        cancelAnimationFrame(frame);
        if (points.length === 0) return Promise.resolve();

        const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
        const legs = points.slice(1).map((point, index) => {
            const start = points[index]!;
            return { start, end: point, length: Math.hypot(point[0] - start[0], point[1] - start[1]) };
        });
        const total = legs.reduce((sum, leg) => sum + leg.length, 0);
        const duration = still ? legs.length * 350 : (total / pixelsPerSecond) * 1000;

        position.value = points[0]!;
        travelling.value = true;

        return new Promise((resolve) => {
            const began = performance.now();

            const step = (now: number) => {
                const progress = Math.min(1, (now - began) / Math.max(duration, 1));

                if (still) {
                    position.value = points[Math.min(points.length - 1, Math.floor(progress * legs.length) + (progress === 1 ? 0 : 1))]!;
                } else {
                    let left = progress * total;
                    for (const leg of legs) {
                        if (left <= leg.length || leg === legs[legs.length - 1]) {
                            const share = leg.length ? Math.min(1, left / leg.length) : 1;
                            position.value = [
                                leg.start[0] + (leg.end[0] - leg.start[0]) * share,
                                leg.start[1] + (leg.end[1] - leg.start[1]) * share,
                            ];
                            break;
                        }
                        left -= leg.length;
                    }
                }

                if (progress < 1) {
                    frame = requestAnimationFrame(step);
                    return;
                }

                travelling.value = false;
                resolve();
            };

            frame = requestAnimationFrame(step);
        });
    }

    return { position, travelling, travel };
}
