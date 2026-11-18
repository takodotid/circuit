// The graph saved as an SVG, drawn from where each box and line is.

import { describe, expect, test } from "bun:test";
import { GraphSvg } from "../../src/studio/app/src/lib/graph-svg";

describe("the graph as an SVG", () => {
    test("lines under boxes, each with its label, framed with a margin", () => {
        const svg = GraphSvg.of({
            box: { x: 0, y: 0, width: 200, height: 100 },
            background: "#eff2f9",
            font: '"Special Gothic", sans-serif',
            nodes: [
                {
                    x: 20,
                    y: 50,
                    width: 60,
                    height: 34,
                    label: "edge-01",
                    fill: "#fff",
                    stroke: "#11141b",
                    strokeWidth: 2,
                    dashed: false,
                    color: "#11141b",
                    fontSize: 13,
                    opacity: 1,
                    device: { chassis: "#0a47b8", socket: "#ffffff", sub: "routeros CCR2216", subColor: "#49536a", mono: "monospace" },
                },
                {
                    x: 180,
                    y: 50,
                    width: 70,
                    height: 34,
                    label: "AS6939 <HE>",
                    fill: "#fff",
                    stroke: "#7b86a0",
                    strokeWidth: 2,
                    dashed: true,
                    color: "#49536a",
                    fontSize: 13,
                    opacity: 1,
                },
            ],
            edges: [
                {
                    from: { x: 50, y: 50 },
                    to: { x: 145, y: 50 },
                    control: { x: 100, y: 30 },
                    middle: { x: 100, y: 40 },
                    label: "hurricane-electric",
                    color: "#7b86a0",
                    width: 2,
                    dashed: false,
                    labelColor: "#49536a",
                    fontSize: 11,
                    opacity: 1,
                },
            ],
        });

        expect(svg).toStartWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="-24 -24 248 148"');
        expect(svg).toContain('<path d="M50 50 Q100 30 145 50"');
        expect(svg).toContain("AS6939 &lt;HE&gt;");
        expect(svg).toContain('stroke-dasharray="6 4"');
        expect(svg.indexOf("<path")).toBeLessThan(svg.indexOf("edge-01"));

        // A device's tag carries its chassis mark, six sockets, and its platform and model under its name.
        expect(svg).toContain('<rect x="6" y="35" width="34" height="30" rx="4" fill="#0a47b8"/>');
        expect(svg.match(/width="6" height="6"/g)).toHaveLength(6);
        expect(svg).toContain(">routeros CCR2216</text>");
    });
});
