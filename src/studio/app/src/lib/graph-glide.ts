// A glide moves nodes or the view from where they are to where they go. Every glide counts time the same way, so nodes and the view that start together arrive together. A frame that comes late counts as one frame: after a stall, a glide goes on from where it was instead of jumping ahead. A glide that replaces another starts at the speed the other had, so nothing stops suddenly.

import type { Point } from "./graph-layout";

export type View = { zoom: number; pan: Point };

/** A place as three numbers: a node's x and y, or the point in the middle of a view and the logarithm of its zoom, so it zooms evenly. */
type Place = { x: number; y: number; z: number };

/** What glides: from where, to where, and how fast it moves at the start, per millisecond. */
export type Motion = { from: Place; to: Place; speed: Place };

export type GlideOptions = {
    time?: number;
    /** The time of the frame the glide goes on from, such as the last frame of a glide it replaces, so its first frame moves too. */
    since?: number;
    done?: () => void;
};

export class GraphGlide {
    /** How long nodes and the view take to glide to a new layer, a framing, or a device. */
    static readonly TIME = 700;
    /** The most time one frame counts for, as at 30 frames a second. */
    static readonly LONGEST_FRAME = 1000 / 30;
    /** The speed of what is at rest. */
    static readonly AT_REST: Place = { x: 0, y: 0, z: 0 };

    /**
     * Where a motion is, a share `s` of the way through a glide of `time`. From rest it is slow at both ends and quick in the middle. With a
     * speed at the start, it carries on at that speed and turns towards where it goes.
     */
    static at(motion: Motion, s: number, time: number): Place {
        const eased = s < 0.5 ? 4 * s ** 3 : 1 - (-2 * s + 2) ** 3 / 2;
        const carried = s * (1 - s) ** 2 * time;
        return GraphGlide.each(motion, (from, to, speed) => from + (to - from) * eased + speed * carried);
    }

    /** How fast a motion moves there, per millisecond. */
    static speedAt(motion: Motion, s: number, time: number): Place {
        const eased = s < 0.5 ? 12 * s ** 2 : 3 * (-2 * s + 2) ** 2;
        const carried = (1 - s) * (1 - 3 * s);
        return GraphGlide.each(motion, (from, to, speed) => ((to - from) * eased) / time + speed * carried);
    }

    private static each(motion: Motion, one: (from: number, to: number, speed: number) => number): Place {
        const { from, to, speed } = motion;
        return { x: one(from.x, to.x, speed.x), y: one(from.y, to.y, speed.y), z: one(from.z, to.z, speed.z) };
    }

    /** A view as a place, on a canvas this size. */
    static placeOf(view: View, size: { width: number; height: number }): Place {
        return { x: (size.width / 2 - view.pan.x) / view.zoom, y: (size.height / 2 - view.pan.y) / view.zoom, z: Math.log(view.zoom) };
    }

    /** The view at a place, on a canvas this size. */
    static viewAt(place: Place, size: { width: number; height: number }): View {
        const zoom = Math.exp(place.z);
        return { zoom, pan: { x: size.width / 2 - place.x * zoom, y: size.height / 2 - place.y * zoom } };
    }

    readonly time: number;
    private elapsed = 0;
    private last: number | undefined;
    private stopped = false;
    private gone = 0;

    /** Call `step` once a frame with the share of the glide's time gone, from 0 to 1, then `done`. `frame` asks for the next frame, as `requestAnimationFrame` does. */
    constructor(
        private readonly step: (s: number) => void,
        private readonly frame: (next: (now: number) => void) => void,
        private readonly options: GlideOptions = {}
    ) {
        this.time = options.time ?? GraphGlide.TIME;
        frame(this.tick);
    }

    /** The share of the glide's time gone, as of the last frame. */
    get share(): number {
        return this.gone;
    }

    /** The time of the glide's last frame. */
    get lastFrame(): number | undefined {
        return this.last;
    }

    /** Stop where it is. */
    stop(): void {
        this.stopped = true;
    }

    private readonly tick = (now: number): void => {
        if (this.stopped) return;

        const since = this.last ?? this.options.since;
        this.elapsed += since === undefined ? 0 : Math.min(now - since, GraphGlide.LONGEST_FRAME);
        this.last = now;
        this.gone = Math.min(this.elapsed / this.time, 1);
        this.step(this.gone);

        if (this.gone < 1) this.frame(this.tick);
        else this.options.done?.();
    };
}
