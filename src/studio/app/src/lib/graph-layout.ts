// Where each node of the graph is, layer by layer. A layer is laid out once, then kept: a device moved stays moved, and a new device is placed beside one it has a line to, so the drawing does not jump when the project changes.

import type { Layer } from "../../../../core/graph";

export type Point = { x: number; y: number };

/** A node to place, with the width of its tag. */
export type Box = { id: string; label: string; width: number };

/** Places as the browser keeps them, rounded, by layer and node id. */
export type Kept = Partial<Record<Layer, Record<string, [number, number]>>>;

export class GraphLayout {
    /** The least gap between two tags side by side. */
    static readonly GAP = 24;
    /** The least distance between the centers of two tags one above the other. */
    static readonly ROW = 96;
    /** The length a line pulls its ends towards. */
    private static readonly IDEAL = 170;

    private readonly layers = new Map<Layer, Map<string, Point>>();

    constructor(kept: Kept = {}) {
        for (const [layer, places] of Object.entries(kept) as [Layer, Record<string, [number, number]>][]) {
            this.layers.set(layer, new Map(Object.entries(places).map(([id, [x, y]]) => [id, { x, y }])));
        }
    }

    /** Where each node is on a layer. */
    places(layer: Layer): Map<string, Point> {
        let places = this.layers.get(layer);
        if (!places) {
            places = new Map();
            this.layers.set(layer, places);
        }
        return places;
    }

    /** Forget a layer's places, to lay it out again. */
    forget(layer: Layer): void {
        this.places(layer).clear();
    }

    /** Place a layer's nodes that have no place yet, starting from `seed` where it has them. */
    layOut(layer: Layer, boxes: readonly Box[], edges: readonly { from: string; to: string }[], seed?: ReadonlyMap<string, Point>): void {
        GraphLayout.arrange(boxes, edges, this.places(layer), seed);
    }

    /** Every layer's places, rounded, to keep in the browser. */
    kept(): Kept {
        const kept: Kept = {};
        for (const [layer, places] of this.layers) {
            kept[layer] = Object.fromEntries([...places].map(([id, point]) => [id, [Math.round(point.x), Math.round(point.y)]]));
        }
        return kept;
    }

    /** A number from 0 to 1, always the same for the same text, so a layout comes out the same each time. */
    static hash(text: string): number {
        let value = 2166136261;
        for (const char of text) value = Math.imul(value ^ char.charCodeAt(0), 16777619);
        return (value >>> 0) / 4294967296;
    }

    /**
     * Place nodes with a force layout: every node pushes every other away, and each line pulls its ends together. A node that has a place
     * keeps it. A new one starts where `seed` has it, else beside a neighbour that has a place, else on a circle, and moves. A node with no
     * line is parked in a row under the drawing, by name. At the end no two tags overlap.
     */
    static arrange(
        boxes: readonly Box[],
        edges: readonly { from: string; to: string }[],
        places: Map<string, Point>,
        seed?: ReadonlyMap<string, Point>
    ): void {
        const half = (box: Box) => box.width / 2;
        const fixed = new Set(boxes.filter((box) => places.has(box.id)).map((box) => box.id));

        const neighbors = new Map<string, Set<string>>();
        for (const edge of edges) {
            if (edge.from === edge.to) continue;
            neighbors.set(edge.from, (neighbors.get(edge.from) ?? new Set()).add(edge.to));
            neighbors.set(edge.to, (neighbors.get(edge.to) ?? new Set()).add(edge.from));
        }

        // A device with no line on this layer waits in a row under the drawing, rather than being pushed to its edges by the rest.
        const loose = edges.length ? boxes.filter((box) => !neighbors.has(box.id) && !places.has(box.id)) : [];
        const linked = boxes.filter((box) => !loose.includes(box));

        // A new node starts beside a neighbour already placed, or on a circle.
        const radius = 60 * Math.sqrt(linked.length + 1);

        for (const box of linked) {
            if (places.has(box.id)) continue;

            const start = seed?.get(box.id);
            if (start) {
                places.set(box.id, { ...start });
                continue;
            }

            const angle = GraphLayout.hash(box.id) * Math.PI * 2;
            const neighbor = [...(neighbors.get(box.id) ?? [])].map((id) => places.get(id)).find(Boolean);
            const distance = neighbor ? 90 : radius;
            const origin = neighbor ?? { x: 0, y: 0 };
            places.set(box.id, { x: origin.x + Math.cos(angle) * distance, y: origin.y + Math.sin(angle) * distance });
        }

        const moving = linked.filter((box) => !fixed.has(box.id));
        if (moving.length) {
            GraphLayout.settle(linked, moving, neighbors, places, fixed.size ? 200 : 500);
            GraphLayout.separate(linked, fixed, places, half);
        }

        GraphLayout.park(loose, linked, places, half);
    }

    /** The force layout itself: the moving nodes move, a step smaller each round. */
    private static settle(
        boxes: readonly Box[],
        moving: readonly Box[],
        neighbors: Map<string, Set<string>>,
        places: Map<string, Point>,
        rounds: number
    ): void {
        const ideal = GraphLayout.IDEAL;
        const at = (id: string) => places.get(id)!;
        const pairs = [...neighbors].flatMap(([from, tos]) => [...tos].filter((to) => from < to).map((to) => [from, to] as const));

        for (let round = 0; round < rounds; round++) {
            const heat = 40 * (1 - round / rounds) + 1;
            const push = new Map(boxes.map((box) => [box.id, { x: 0, y: 0 }]));
            const pushOf = (id: string) => push.get(id)!;

            for (const [index, a] of boxes.entries()) {
                for (const b of boxes.slice(index + 1)) {
                    let dx = at(a.id).x - at(b.id).x;
                    let dy = at(a.id).y - at(b.id).y;

                    // Two nodes in one place are pulled apart in a direction of their own.
                    if (dx === 0 && dy === 0) {
                        dx = GraphLayout.hash(a.id + b.id) - 0.5;
                        dy = GraphLayout.hash(b.id + a.id) - 0.5;
                    }

                    // Nodes far apart no longer push, so parts that are not connected stay near each other.
                    const distance = Math.max(Math.hypot(dx, dy), 1);
                    if (distance > ideal * 3) continue;

                    const force = (ideal * ideal) / distance;
                    pushOf(a.id).x += (dx / distance) * force;
                    pushOf(a.id).y += (dy / distance) * force;
                    pushOf(b.id).x -= (dx / distance) * force;
                    pushOf(b.id).y -= (dy / distance) * force;
                }
            }

            for (const [from, to] of pairs) {
                if (!places.has(from) || !places.has(to) || !push.has(from) || !push.has(to)) continue;

                const dx = at(from).x - at(to).x;
                const dy = at(from).y - at(to).y;
                const distance = Math.max(Math.hypot(dx, dy), 1);
                const force = (distance * distance) / ideal;
                pushOf(from).x -= (dx / distance) * force;
                pushOf(from).y -= (dy / distance) * force;
                pushOf(to).x += (dx / distance) * force;
                pushOf(to).y += (dy / distance) * force;
            }

            for (const box of moving) {
                const point = at(box.id);
                const force = pushOf(box.id);

                // A pull to the middle keeps parts that are not connected from drifting away.
                force.x -= point.x * 0.15;
                force.y -= point.y * 0.15;

                const length = Math.max(Math.hypot(force.x, force.y), 1);
                const step = Math.min(length, heat);
                point.x += (force.x / length) * step;
                point.y += (force.y / length) * step;
            }
        }
    }

    /** No tag may cover another: two that overlap are pushed apart the shorter way out. A node that kept its place stays. */
    private static separate(
        boxes: readonly Box[],
        fixed: ReadonlySet<string>,
        places: Map<string, Point>,
        half: (box: Box) => number
    ): void {
        for (let round = 0; round < 80; round++) {
            let overlapping = false;

            for (const [index, a] of boxes.entries()) {
                for (const b of boxes.slice(index + 1)) {
                    const aMoves = !fixed.has(a.id);
                    const bMoves = !fixed.has(b.id);
                    if (!aMoves && !bMoves) continue;

                    const pa = places.get(a.id)!;
                    const pb = places.get(b.id)!;
                    const overlapX = half(a) + half(b) + GraphLayout.GAP - Math.abs(pa.x - pb.x);
                    const overlapY = GraphLayout.ROW - Math.abs(pa.y - pb.y);
                    if (overlapX <= 0 || overlapY <= 0) continue;

                    overlapping = true;
                    const share = aMoves && bMoves ? 0.5 : 1;
                    const sideways = overlapX < overlapY * 2;
                    const sign = sideways ? Math.sign(pa.x - pb.x) || 1 : Math.sign(pa.y - pb.y) || 1;
                    const distance = (sideways ? overlapX : overlapY) * share;

                    if (aMoves && sideways) pa.x += sign * distance;
                    if (aMoves && !sideways) pa.y += sign * distance;
                    if (bMoves && sideways) pb.x -= sign * distance;
                    if (bMoves && !sideways) pb.y -= sign * distance;
                }
            }

            if (!overlapping) return;
        }
    }

    /** Set nodes with no line in rows under the others, sorted by name. */
    private static park(loose: readonly Box[], linked: readonly Box[], places: Map<string, Point>, half: (box: Box) => number): void {
        if (!loose.length) return;

        const placed = linked.flatMap((box) => places.get(box.id) ?? []);
        const left = placed.length ? Math.min(...placed.map((point) => point.x)) : 0;
        const right = left + Math.max(placed.length ? Math.max(...placed.map((point) => point.x)) - left : 0, 900);
        let x = left;
        let y = (placed.length ? Math.max(...placed.map((point) => point.y)) : 0) + 130;

        for (const box of [...loose].sort((a, b) => a.label.localeCompare(b.label))) {
            if (x > left && x + half(box) * 2 > right) {
                x = left;
                y += GraphLayout.ROW;
            }

            places.set(box.id, { x: x + half(box), y });
            x += half(box) * 2 + GraphLayout.GAP;
        }
    }
}
