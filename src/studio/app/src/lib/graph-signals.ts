// Dots that travel each line both ends declare, so a link that works reads as one that carries traffic. Cytoscape draws on a canvas of its own, so the dots are drawn on a second canvas laid over it, from where Cytoscape draws each line, once a frame. A line one end declares, or one a comparison shows is gone, carries none.

import type { Core, EdgeSingular } from "cytoscape";
import { GraphLayout } from "./graph-layout";
import type { Point } from "./graph-layout";

export type SignalColors = { dot: string; lit: string; ring: string; added: string };

/** One dot as drawn, at the drawing's zoom. */
type Dot = { at: Point; color: string; lit: boolean; opacity: number };

export class GraphSignals {
    /** How fast the dots travel, in pixels a second, and how fast while presenting. */
    private static readonly SPEED = 45;
    private static readonly PRESENTING_SPEED = 110;
    /** The shortest and longest time a dot takes along a line, in seconds. */
    private static readonly FASTEST = 1.6;
    private static readonly SLOWEST = 12;
    /** A line fainter than this carries no dots. */
    private static readonly FAINTEST = 0.05;
    /** How long the dots take to fade in. */
    private static readonly FADE_IN = 300;
    /** A dot's radius, a lit dot's radius, and the width of a lit dot's ring. */
    private static readonly DOT = 3.5;
    private static readonly LIT_DOT = 4.5;
    private static readonly RING = 1.5;
    /** A second, in milliseconds. */
    private static readonly SECOND = 1000;

    /** While presenting, the dots are quicker, and each line carries one each way. */
    presenting = false;
    /** The dots show from this time on, fading in, so they come after the lines while the drawing arrives. */
    showFrom = 0;
    private frame: number | undefined;

    constructor(
        private readonly cy: Core,
        private readonly canvas: HTMLCanvasElement,
        private colors: SignalColors
    ) {}

    start(): void {
        if (this.frame === undefined) this.frame = requestAnimationFrame(this.draw);
    }

    stop(): void {
        if (this.frame !== undefined) cancelAnimationFrame(this.frame);
        this.frame = undefined;

        // The last frame leaves the pan and zoom set: without them, the clear covers the whole canvas.
        const context = this.canvas.getContext("2d");
        context?.setTransform(1, 0, 0, 1, 0, 0);
        context?.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }

    recolor(colors: SignalColors): void {
        this.colors = colors;
    }

    /** The point a share `t` of the way along a line, from its ends and the bend Cytoscape gave it. */
    private static along(points: readonly Point[], t: number): Point {
        // De Casteljau: a curve through its control points, as Cytoscape draws a bent line.
        let level = [...points];
        while (level.length > 1) {
            level = level.slice(1).map((point, index) => ({
                x: level[index]!.x + (point.x - level[index]!.x) * t,
                y: level[index]!.y + (point.y - level[index]!.y) * t,
            }));
        }
        return level[0]!;
    }

    private dotsOf(edge: EdgeSingular, now: number, appear: number, zoom: number): Dot[] {
        if (edge.data("oneSided") || edge.data("gone") || !edge.visible()) return [];

        const opacity = edge.effectiveOpacity() * appear;
        if (opacity < GraphSignals.FAINTEST) return [];

        const from = edge.sourceEndpoint();
        const to = edge.targetEndpoint();
        const points = [from, ...(edge.controlPoints() ?? []), to];

        // Speed by length, so a long line is not a blur; each line starts at a point of its own.
        const length = Math.hypot(to.x - from.x, to.y - from.y);
        const speed = this.presenting ? GraphSignals.PRESENTING_SPEED : GraphSignals.SPEED;
        const seconds = Math.min(Math.max(length / speed, GraphSignals.FASTEST), GraphSignals.SLOWEST);
        const phase = GraphLayout.hash(edge.id());
        const backwards = this.presenting ? [false, true] : [GraphLayout.hash(String(edge.data("label"))) < 0.5];
        const lit = edge.hasClass("lit") || edge.hasClass("picked");
        const color = edge.data("added") ? this.colors.added : lit ? this.colors.lit : this.colors.dot;

        return backwards.map((back, index) => {
            const travelled = (now / GraphSignals.SECOND / seconds + phase + index / 2) % 1;
            const at = GraphSignals.along(points, back ? 1 - travelled : travelled);
            return { at: { x: at.x * zoom, y: at.y * zoom }, color, lit, opacity };
        });
    }

    private readonly draw = (now: number): void => {
        this.frame = requestAnimationFrame(this.draw);

        const canvas = this.canvas;
        const scale = devicePixelRatio || 1;
        const width = Math.round(canvas.clientWidth * scale);
        const height = Math.round(canvas.clientHeight * scale);
        if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width;
            canvas.height = height;
        }

        const context = canvas.getContext("2d");
        if (!context) return;
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.clearRect(0, 0, width, height);

        const appear = Math.min(Math.max((now - this.showFrom) / GraphSignals.FADE_IN, 0), 1);
        if (appear === 0) return;

        const zoom = this.cy.zoom();
        const pan = this.cy.pan();
        context.setTransform(scale, 0, 0, scale, pan.x * scale, pan.y * scale);

        // A line can pass under a tag: its dots hide there, as they would under the tag on paper.
        const tags = this.cy.nodes().map((node) => {
            const at = node.position();
            const width = node.width() / 2;
            const height = node.height() / 2;
            return {
                left: (at.x - width) * zoom,
                right: (at.x + width) * zoom,
                top: (at.y - height) * zoom,
                bottom: (at.y + height) * zoom,
            };
        });
        const underTag = (point: Point) =>
            tags.some((tag) => point.x > tag.left && point.x < tag.right && point.y > tag.top && point.y < tag.bottom);

        this.cy.edges().forEach((edge) => {
            for (const dot of this.dotsOf(edge, now, appear, zoom)) {
                if (underTag(dot.at)) continue;
                context.globalAlpha = dot.opacity;
                context.beginPath();
                context.arc(dot.at.x, dot.at.y, (dot.lit ? GraphSignals.LIT_DOT : GraphSignals.DOT) * zoom, 0, Math.PI * 2);
                context.fillStyle = dot.color;
                context.fill();

                if (dot.lit) {
                    context.lineWidth = GraphSignals.RING * zoom;
                    context.strokeStyle = this.colors.ring;
                    context.stroke();
                }
            }
        });

        context.globalAlpha = 1;
    };
}
