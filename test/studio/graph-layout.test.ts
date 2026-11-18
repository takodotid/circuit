// Where the graph places its nodes. Only new ones move, and a new one starts beside a neighbor. Devices with no line wait in a row. No two tags overlap, and each line is long enough to see.

import { describe, expect, test } from "bun:test";
import { GraphLayout } from "../../src/studio/app/src/lib/graph-layout";
import type { Box, Point } from "../../src/studio/app/src/lib/graph-layout";

const box = (id: string, width = 120): Box => ({ id, label: id.replace("device:", ""), width, height: 62 });

/** Whether two tags overlap, with the layout's gaps. */
function overlap(places: Map<string, Point>, a: Box, b: Box): boolean {
    const pa = places.get(a.id)!;
    const pb = places.get(b.id)!;
    return Math.abs(pa.x - pb.x) < (a.width + b.width) / 2 && Math.abs(pa.y - pb.y) < 40;
}

/** How long a line between two tags shows: from where it leaves one tag to where it meets the other. */
function shown(places: Map<string, Point>, a: Box, b: Box): number {
    const pa = places.get(a.id)!;
    const pb = places.get(b.id)!;
    const distance = Math.hypot(pa.x - pb.x, pa.y - pb.y);
    const x = Math.abs(pa.x - pb.x) / distance;
    const y = Math.abs(pa.y - pb.y) / distance;
    const inside = (tag: Box) => Math.min(tag.width / 2 / x, tag.height / 2 / y);
    return distance - inside(a) - inside(b);
}

describe("laying out the graph", () => {
    test("a node with a place keeps it, and a new one starts beside its neighbor", () => {
        const places = new Map<string, Point>([
            ["device:edge-01", { x: 0, y: 0 }],
            ["device:tor-01", { x: 300, y: 0 }],
        ]);
        const boxes = [box("device:edge-01"), box("device:tor-01"), box("device:tor-02")];
        const edges = [
            { from: "device:edge-01", to: "device:tor-01" },
            { from: "device:tor-01", to: "device:tor-02" },
        ];

        GraphLayout.arrange(boxes, edges, places);

        expect(places.get("device:edge-01")).toEqual({ x: 0, y: 0 });
        expect(places.get("device:tor-01")).toEqual({ x: 300, y: 0 });
        const added = places.get("device:tor-02")!;
        expect(Math.hypot(added.x - 300, added.y)).toBeLessThan(400);
    });

    test("a layer starts from where the seed has its nodes, so it still looks like the same network", () => {
        const places = new Map<string, Point>();
        const seed = new Map<string, Point>([
            ["device:west", { x: -400, y: 0 }],
            ["device:east", { x: 400, y: 0 }],
            ["device:south", { x: 0, y: 400 }],
        ]);
        const boxes = [box("device:west"), box("device:east"), box("device:south")];

        GraphLayout.arrange(boxes, [{ from: "device:west", to: "device:east" }], places, seed);

        expect(places.get("device:west")!.x).toBeLessThan(places.get("device:east")!.x);
    });

    test("devices with no line wait in a row under the drawing, by name", () => {
        const places = new Map<string, Point>();
        const boxes = [box("device:a"), box("device:b"), box("device:zulu"), box("device:alpha")];

        GraphLayout.arrange(boxes, [{ from: "device:a", to: "device:b" }], places);

        const drawn = Math.max(places.get("device:a")!.y, places.get("device:b")!.y);
        const alpha = places.get("device:alpha")!;
        const zulu = places.get("device:zulu")!;
        expect(alpha.y).toBeGreaterThan(drawn);
        expect(alpha.y).toBe(zulu.y);
        expect(alpha.x).toBeLessThan(zulu.x);
    });

    test("no two tags overlap", () => {
        const places = new Map<string, Point>();
        const boxes = [box("device:core", 200), ...Array.from({ length: 14 }, (_, index) => box(`device:access-${index}`, 180))];
        const edges = boxes.slice(1).map((leaf) => ({ from: "device:core", to: leaf.id }));

        GraphLayout.arrange(boxes, edges, places);

        for (const [index, a] of boxes.entries()) for (const b of boxes.slice(index + 1)) expect(overlap(places, a, b)).toBe(false);
    });

    test("each line shows long enough beside its label, however wide the tags at its ends", () => {
        const places = new Map<string, Point>();
        const boxes = [
            box("device:core", 320),
            box("device:edge", 320),
            ...Array.from({ length: 8 }, (_, index) => box(`device:access-${index}`, 300)),
        ];
        const edges = [{ from: "device:core", to: "device:edge" }, ...boxes.slice(2).map((leaf) => ({ from: "device:core", to: leaf.id }))];

        GraphLayout.arrange(boxes, edges, places);

        const byId = new Map(boxes.map((each) => [each.id, each]));
        for (const edge of edges)
            expect(shown(places, byId.get(edge.from)!, byId.get(edge.to)!)).toBeGreaterThanOrEqual(GraphLayout.SHORTEST - 1);
    });

    test("the same network comes out the same each time", () => {
        const boxes = [box("device:a"), box("device:b"), box("device:c")];
        const edges = [
            { from: "device:a", to: "device:b" },
            { from: "device:b", to: "device:c" },
        ];
        const first = new Map<string, Point>();
        const second = new Map<string, Point>();

        GraphLayout.arrange(boxes, edges, first);
        GraphLayout.arrange(boxes, edges, second);

        expect([...second]).toEqual([...first]);
    });

    test("keeps each layer's places, and forgets one layer's to lay it out again", () => {
        const layouts = new GraphLayout({ l1: { "device:a": [10, 20] } });

        expect(layouts.places("l1").get("device:a")).toEqual({ x: 10, y: 20 });
        expect(layouts.places("bgp").size).toBe(0);

        layouts.forget("l1");
        expect(layouts.places("l1").size).toBe(0);
    });
});
