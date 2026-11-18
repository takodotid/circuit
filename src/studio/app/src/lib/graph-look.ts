// How the graph looks: Cytoscape's stylesheet, built from the page's colours, so the drawing has the same palette as the rest of Studio.

import type { NodeSingular, StylesheetJson } from "cytoscape";

/** The page's colours and fonts the drawing uses, read from its CSS as they are now. */
export type Colors = {
    dark: boolean;
    bg: string;
    surface: string;
    text: string;
    muted: string;
    edge: string;
    link: string;
    cobalt: string;
    navy: string;
    yellow: string;
    yellowDeep: string;
    selected: string;
    warning: string;
    error: string;
    ok: string;
    font: string;
    mono: string;
};

/**
 * A node's tag: its size, and for a device, where its name sits and the drawing behind it: a small front panel, a chassis with two rows of
 * sockets, and the platform and model under the name. The drawing comes as it looks normally, selected, and lit while presenting.
 */
export type Tag = { width: number; height: number; shift: number; image?: string; picked?: string; touring?: string };

export class GraphLook {
    /** The height of a segment's or an outside node's tag. */
    static readonly HEIGHT = 34;
    /** The height of a device's tag, with its name over its platform and model. */
    static readonly DEVICE_HEIGHT = 62;
    /** Where a device's text starts, after its chassis mark. */
    private static readonly TEXT_X = 62;

    private static context: CanvasRenderingContext2D | null | undefined;

    /** How wide a text is drawn in a font. */
    private static measure(text: string, font: string): number {
        GraphLook.context ??= document.createElement("canvas").getContext("2d");
        if (!GraphLook.context) return text.length * 9;
        GraphLook.context.font = font;
        return GraphLook.context.measureText(text).width;
    }

    private static escape(text: string): string {
        return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
    }

    /** A device's drawing: the chassis mark at the left, and its platform and model under where the name goes. */
    private static panel(width: number, sub: string, chassis: string, socket: string, text: string, mono: string): string {
        const sockets = [0, 1].flatMap((row) =>
            [0, 1, 2].map((column) => `<rect x="${22 + column * 8}" y="${23 + row * 9}" width="6" height="6" rx="1" fill="${socket}"/>`)
        );
        const svg = [
            `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${GraphLook.DEVICE_HEIGHT}" viewBox="0 0 ${width} ${GraphLook.DEVICE_HEIGHT}">`,
            `<rect x="16" y="16" width="34" height="30" rx="4" fill="${chassis}"/>`,
            ...sockets,
            `<text x="${GraphLook.TEXT_X}" y="44" font-family="${GraphLook.escape(mono)}" font-size="12" fill="${text}" dominant-baseline="central">${GraphLook.escape(sub)}</text>`,
            "</svg>",
        ].join("");
        return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
    }

    /** A node's tag, measured in the fonts it is drawn in. */
    static tag(node: { kind: string; label: string; detail: string[] }, colors: Colors): Tag {
        if (node.kind !== "device") {
            const width = GraphLook.measure(node.label, `400 12px ${colors.mono}`) + 28;
            return { width, height: GraphLook.HEIGHT, shift: 0 };
        }

        const sub = node.detail[0] ?? "";
        const name = GraphLook.measure(node.label, `700 18px ${colors.font}`);
        const width = Math.ceil(Math.max(name, GraphLook.measure(sub, `400 12px ${colors.mono}`), 110) + GraphLook.TEXT_X + 18);

        return {
            width,
            height: GraphLook.DEVICE_HEIGHT,
            // The name is drawn centered on this point, so it starts where the text does.
            shift: GraphLook.TEXT_X + name / 2 - width / 2,
            image: GraphLook.panel(width, sub, colors.cobalt, "#ffffff", colors.muted, colors.mono),
            picked: GraphLook.panel(width, sub, colors.cobalt, colors.yellow, colors.muted, colors.mono),
            touring: GraphLook.panel(width, sub, colors.navy, colors.yellow, "#2a3550", colors.mono),
        };
    }

    static colors(): Colors {
        const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
        return {
            dark: matchMedia("(prefers-color-scheme: dark)").matches,
            bg: css("--bg"),
            surface: css("--surface"),
            text: css("--text"),
            muted: css("--muted"),
            edge: css("--edge"),
            link: css("--accent"),
            cobalt: css("--cobalt"),
            navy: css("--navy"),
            yellow: css("--yellow"),
            yellowDeep: css("--yellow-deep"),
            selected: css("--selected"),
            warning: css("--warning"),
            error: css("--error"),
            ok: css("--ok"),
            font: css("--font"),
            mono: css("--mono"),
        };
    }

    /** The stylesheet. With `still`, a change shows at once instead of over a quarter second. */
    static style(colors: Colors, still: boolean): StylesheetJson {
        // Lighting a part dims the rest gently, so the eye follows what changed.
        const gently = { "transition-duration": still ? 0 : 250, "transition-timing-function": "ease-out" as const };

        return [
            {
                selector: "node",
                style: {
                    shape: "round-rectangle",
                    width: "data(width)",
                    height: "data(height)",
                    "background-color": colors.surface,
                    "border-width": 2,
                    "border-color": colors.text,
                    label: "data(label)",
                    color: colors.text,
                    "font-family": colors.font,
                    "font-size": 13,
                    "font-weight": 700,
                    "text-valign": "center",
                    "text-halign": "center",
                    "transition-property": "opacity, background-color, border-color, border-width",
                    ...gently,
                },
            },
            // A device's tag: the drawing of its front panel and its platform and model, and its name over them.
            {
                selector: 'node[kind = "device"]',
                style: {
                    "background-image": "data(image)",
                    "background-width": "100%",
                    "background-height": "100%",
                    "background-fit": "none",
                    "font-size": 18,
                    "text-margin-x": (node: NodeSingular) => Number(node.data("shift")),
                    "text-margin-y": -9,
                },
            },
            { selector: 'node.picked[kind = "device"]', style: { "background-image": "data(picked)" } },
            { selector: 'node.touring[kind = "device"]', style: { "background-image": "data(touring)" } },
            {
                selector: 'node[kind = "segment"]',
                style: {
                    "background-color": colors.yellow,
                    "background-opacity": colors.dark ? 0.16 : 0.32,
                    "border-color": colors.yellowDeep,
                    "font-family": colors.mono,
                    "font-weight": 400,
                    "font-size": 12,
                },
            },
            {
                selector: 'node[kind = "outside"]',
                style: {
                    "background-color": colors.bg,
                    "border-style": "dotted",
                    "border-color": colors.edge,
                    color: colors.muted,
                    "font-family": colors.mono,
                    "font-weight": 400,
                    "font-size": 12,
                },
            },
            { selector: 'node[level = "warning"]', style: { "border-color": colors.warning, "border-width": 4, "border-style": "dashed" } },
            { selector: 'node[level = "error"]', style: { "border-color": colors.error, "border-width": 4 } },
            // A comparison: a node that is gone is drawn pale with a dashed frame, at the end of the line gone to it.
            {
                selector: "node[?gone]",
                style: {
                    "background-color": colors.bg,
                    "background-image-opacity": 0.35,
                    "border-style": "dashed",
                    "border-color": colors.muted,
                    color: colors.muted,
                },
            },
            {
                selector: "edge",
                style: {
                    width: 2,
                    "line-color": colors.edge,
                    "curve-style": "bezier",
                    label: "data(label)",
                    "font-family": colors.font,
                    "font-size": 11,
                    color: colors.muted,
                    "text-background-color": colors.bg,
                    "text-background-opacity": 1,
                    "text-background-padding": "2px",
                    // Zoomed far out, a line's label is too small to read, and is left out.
                    "min-zoomed-font-size": 6,
                    "transition-property": "opacity, line-color, width",
                    ...gently,
                },
            },
            {
                selector: "edge[?oneSided]",
                style: { "line-style": "dashed", "line-dash-pattern": [4, 4], "line-color": colors.warning, width: 3 },
            },
            // Presenting draws heavier lines.
            { selector: "edge.heavy", style: { width: 3 } },
            { selector: "edge.lit, edge.picked", style: { width: 4, "line-color": colors.link, color: colors.text } },
            // A comparison: a new line is green, a line gone is red and dashed.
            { selector: "edge[?added]", style: { width: 4, "line-color": colors.ok } },
            {
                selector: "edge[?gone]",
                style: { width: 4, "line-color": colors.error, "line-style": "dashed", "line-dash-pattern": [10, 5] },
            },
            { selector: "node.picked", style: { "background-color": colors.selected, "border-color": colors.cobalt, "border-width": 4 } },
            // The device presenting lights: the highlighter fill with a navy frame. A warning or error keeps its own frame.
            { selector: "node.touring", style: { "background-color": colors.yellow, color: "#11141b" } },
            { selector: 'node.touring[level = ""]', style: { "border-color": colors.navy, "border-width": 4 } },
            {
                selector: "node.touring",
                style: { "outline-width": 3, "outline-color": colors.yellowDeep, "outline-offset": 4, "outline-opacity": 1 },
            },
            { selector: ".dim", style: { opacity: 0.18 } },
        ];
    }
}
