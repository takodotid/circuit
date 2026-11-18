// A glide moves nodes or the view from where they are to where they go. Every glide counts time the same way, so nodes and the view that start together arrive together. A frame that comes late counts as one frame: after a stall, a glide goes on from where it was instead of jumping ahead.

import type { Point } from "./graph-layout";

export type View = { zoom: number; pan: Point };

/** A curve from 0 to 1, for a share of the time from 0 to 1. */
type Easing = (t: number) => number;

export type GlideOptions = { time?: number; easing?: Easing; done?: () => void };

export class GraphGlide {
    /** How long nodes and the view take to glide to a new layer, a framing, or a device. */
    static readonly TIME = 700;
    /** The most time one frame counts for, as at 30 frames a second. */
    static readonly LONGEST_FRAME = 1000 / 30;

    /** Slow at both ends and quick in the middle. */
    static readonly EASE_IN_OUT: Easing = (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);
    /** Gentler at both ends, for a slow drift. */
    static readonly SINE: Easing = (t) => (1 - Math.cos(Math.PI * t)) / 2;

    /** The point a share `t` of the way. */
    static between(from: Point, to: Point, t: number): Point {
        return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
    }

    /** The view a share `t` of the way, on a canvas this size: it zooms evenly, and the point in the middle moves in a straight line. */
    static viewBetween(from: View, to: View, t: number, size: { width: number; height: number }): View {
        const middle = (view: View) => ({ x: (size.width / 2 - view.pan.x) / view.zoom, y: (size.height / 2 - view.pan.y) / view.zoom });
        const zoom = from.zoom * (to.zoom / from.zoom) ** t;
        const center = GraphGlide.between(middle(from), middle(to), t);
        return { zoom, pan: { x: size.width / 2 - center.x * zoom, y: size.height / 2 - center.y * zoom } };
    }

    private elapsed = 0;
    private last: number | undefined;
    private stopped = false;

    /** Call `step` once a frame with how far the glide is, eased from 0 to 1, then `done`. `frame` asks for the next frame, as `requestAnimationFrame` does. */
    constructor(
        private readonly step: (t: number) => void,
        private readonly frame: (next: (now: number) => void) => void,
        private readonly options: GlideOptions = {}
    ) {
        frame(this.tick);
    }

    /** Stop where it is. */
    stop(): void {
        this.stopped = true;
    }

    private readonly tick = (now: number): void => {
        if (this.stopped) return;

        this.elapsed += this.last === undefined ? 0 : Math.min(now - this.last, GraphGlide.LONGEST_FRAME);
        this.last = now;
        const t = Math.min(this.elapsed / (this.options.time ?? GraphGlide.TIME), 1);
        this.step((this.options.easing ?? GraphGlide.EASE_IN_OUT)(t));

        if (t < 1) this.frame(this.tick);
        else this.options.done?.();
    };
}
