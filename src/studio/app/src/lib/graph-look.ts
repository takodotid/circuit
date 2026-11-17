// How the graph looks: Cytoscape's stylesheet, built from the page's colours, so the drawing has the same palette as the rest of Studio.

import type { StylesheetJson } from "cytoscape";

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

export class GraphLook {
    /** The height of a node's tag. */
    static readonly HEIGHT = 34;

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
                    height: GraphLook.HEIGHT,
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
            { selector: ".dim", style: { opacity: 0.18 } },
        ];
    }
}
