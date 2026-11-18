// The graph saved as an SVG: Cytoscape draws on a canvas and has no SVG of its own, so this one is drawn from where each box and line is and how Cytoscape styles it.

type Point = { x: number; y: number };

/** The graph as drawn on screen, in the drawing's own coordinates, for `GraphSvg.of`. Colours as CSS colours. */
export type Drawing = {
    box: { x: number; y: number; width: number; height: number };
    background: string;
    font: string;
    nodes: {
        x: number;
        y: number;
        width: number;
        height: number;
        label: string;
        fill: string;
        stroke: string;
        strokeWidth: number;
        dashed: boolean;
        color: string;
        fontSize: number;
        opacity: number;
        /** A device's tag: its chassis mark's colours, and its platform and model under its name. */
        device?: { chassis: string; socket: string; sub: string; subColor: string; mono: string };
    }[];
    edges: {
        from: Point;
        to: Point;
        /** The bend of a curved line, when lines between the same two boxes are drawn apart. */
        control?: Point;
        middle: Point;
        label: string;
        color: string;
        width: number;
        dashed: boolean;
        labelColor: string;
        fontSize: number;
        opacity: number;
    }[];
};

export class GraphSvg {
    /** Text safe inside an SVG element or attribute. */
    private static escape(text: string): string {
        return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
    }

    /** The graph as an SVG file of its own: lines first, then boxes over them, framed around what is drawn, on the page's background. */
    static of(drawing: Drawing): string {
        const margin = 24;
        const x = drawing.box.x - margin;
        const y = drawing.box.y - margin;
        const width = Math.ceil(drawing.box.width + margin * 2);
        const height = Math.ceil(drawing.box.height + margin * 2);
        const n = (value: number) => Number(value.toFixed(1));

        const edges = drawing.edges.map((edge) => {
            const path = edge.control
                ? `M${n(edge.from.x)} ${n(edge.from.y)} Q${n(edge.control.x)} ${n(edge.control.y)} ${n(edge.to.x)} ${n(edge.to.y)}`
                : `M${n(edge.from.x)} ${n(edge.from.y)} L${n(edge.to.x)} ${n(edge.to.y)}`;
            const dash = edge.dashed ? ` stroke-dasharray="${n(edge.width * 3)} ${n(edge.width * 2)}"` : "";
            const line = `<path d="${path}" fill="none" stroke="${edge.color}" stroke-width="${edge.width}"${dash}/>`;
            if (!edge.label) return `<g opacity="${edge.opacity}">${line}</g>`;

            // The label sits on a band of the background, as on screen, so the line does not run through it.
            const labelWidth = edge.label.length * edge.fontSize * 0.58 + 6;
            const band = `<rect x="${n(edge.middle.x - labelWidth / 2)}" y="${n(edge.middle.y - edge.fontSize * 0.75)}" width="${n(labelWidth)}" height="${n(edge.fontSize * 1.5)}" fill="${drawing.background}"/>`;
            const text = `<text x="${n(edge.middle.x)}" y="${n(edge.middle.y)}" fill="${edge.labelColor}" font-size="${edge.fontSize}" text-anchor="middle" dominant-baseline="central">${GraphSvg.escape(edge.label)}</text>`;
            return `<g opacity="${edge.opacity}">${line}${band}${text}</g>`;
        });

        const nodes = drawing.nodes.map((node) => {
            const dash = node.dashed ? ` stroke-dasharray="6 4"` : "";
            const box = `<rect x="${n(node.x - node.width / 2)}" y="${n(node.y - node.height / 2)}" width="${n(node.width)}" height="${n(node.height)}" rx="8" fill="${node.fill}" stroke="${node.stroke}" stroke-width="${node.strokeWidth}"${dash}/>`;

            if (!node.device) {
                const text = `<text x="${n(node.x)}" y="${n(node.y)}" fill="${node.color}" font-size="${node.fontSize}" font-weight="700" text-anchor="middle" dominant-baseline="central">${GraphSvg.escape(node.label)}</text>`;
                return `<g opacity="${node.opacity}">${box}${text}</g>`;
            }

            // A device: its chassis mark at the left, two rows of three sockets, then its name over its platform and model.
            const left = node.x - node.width / 2;
            const { chassis, socket, sub, subColor, mono } = node.device;
            const mark = [
                `<rect x="${n(left + 16)}" y="${n(node.y - 15)}" width="34" height="30" rx="4" fill="${chassis}"/>`,
                ...[0, 1].flatMap((row) =>
                    [0, 1, 2].map(
                        (column) =>
                            `<rect x="${n(left + 22 + column * 8)}" y="${n(node.y - 8 + row * 9)}" width="6" height="6" rx="1" fill="${socket}"/>`
                    )
                ),
            ].join("");
            const name = `<text x="${n(left + 62)}" y="${n(node.y - 9)}" fill="${node.color}" font-size="${node.fontSize}" font-weight="700" dominant-baseline="central">${GraphSvg.escape(node.label)}</text>`;
            const model = `<text x="${n(left + 62)}" y="${n(node.y + 13)}" fill="${subColor}" font-size="12" font-family="${GraphSvg.escape(mono)}" dominant-baseline="central">${GraphSvg.escape(sub)}</text>`;
            return `<g opacity="${node.opacity}">${box}${mark}${name}${model}</g>`;
        });

        return [
            `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${n(x)} ${n(y)} ${width} ${height}" width="${width}" height="${height}" font-family="${GraphSvg.escape(drawing.font)}">`,
            `<rect x="${n(x)}" y="${n(y)}" width="${width}" height="${height}" fill="${drawing.background}"/>`,
            ...edges,
            ...nodes,
            "</svg>",
            "",
        ].join("\n");
    }
}
