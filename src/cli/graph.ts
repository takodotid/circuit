// What `circuit graph` prints: the graph of the network with what `validate` found and how each device compares with its last snapshot, as Mermaid, DOT or JSON.

import type { Finding } from "../core/define";
import { deviceId, type Graph, type GraphNode } from "../core/graph";

/** How a device compares with its last snapshot, found offline as `diff` finds it. */
export type Drift = {
    status: "matches" | "differs" | "no snapshot" | "cannot plan";
    /** The plan `diff` would show, when it differs. */
    lines: string[];
};

export type Annotated = Graph & {
    findings: Finding[];
    /** By device name. */
    drift: Record<string, Drift>;
};

/** `error` when validate found an error on the device, `warning` for a warning or a difference from its snapshot. */
export function markOf(graph: Annotated, node: GraphNode): "error" | "warning" | undefined {
    if (node.kind !== "device") return undefined;

    const findings = graph.findings.filter((finding) => finding.device && deviceId(finding.device) === node.id);
    if (findings.some((finding) => finding.level === "error")) return "error";

    const drift = graph.drift[node.label]?.status;
    if (findings.length || drift === "differs" || drift === "cannot plan") return "warning";

    return undefined;
}

/** Mermaid, which GitHub draws wherever Markdown is shown. */
export function mermaid(graph: Annotated): string {
    const ids = new Map(graph.nodes.map((node, index) => [node.id, `n${index}`]));
    // Lines of text, each escaped, as one quoted label.
    const text = (...lines: string[]) =>
        `"${lines.map((line) => line.replace(/"/g, "#quot;").replace(/</g, "#lt;").replace(/>/g, "#gt;")).join("<br/>")}"`;

    const shapes: Record<GraphNode["kind"], (label: string) => string> = {
        device: (label) => `[${label}]`,
        segment: (label) => `([${label}])`,
        outside: (label) => `{{${label}}}`,
    };

    const lines = ["graph LR"];

    for (const node of graph.nodes) {
        const label = node.kind === "device" ? text(node.label, node.detail[0] ?? "") : text(node.label);
        lines.push(`    ${ids.get(node.id)}${shapes[node.kind](label)}`);
    }

    for (const edge of graph.edges) {
        const arrow = edge.oneSided ? "-.-" : "---";
        lines.push(`    ${ids.get(edge.from)} ${arrow}|${text(edge.label)}| ${ids.get(edge.to)}`);
    }

    lines.push(
        "    classDef error stroke:#d1242f,stroke-width:3px",
        "    classDef warning stroke:#bf8700,stroke-width:3px",
        "    classDef outside stroke-dasharray:4 3"
    );

    for (const node of graph.nodes) {
        const mark = markOf(graph, node) ?? (node.kind === "outside" ? "outside" : undefined);
        if (mark) lines.push(`    class ${ids.get(node.id)} ${mark}`);
    }

    return lines.join("\n") + "\n";
}

/** DOT, which Graphviz turns into an image: `circuit graph --format=dot | dot -Tsvg > network.svg`. */
export function dot(graph: Annotated): string {
    const text = (value: string) => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
    const colors = { error: "#d1242f", warning: "#bf8700" };

    const shapes: Record<GraphNode["kind"], string> = {
        device: "shape=box, style=rounded",
        segment: "shape=ellipse",
        outside: "shape=box, style=dashed",
    };

    const lines = [
        "graph network {",
        "    rankdir=LR;",
        '    node [fontname="Helvetica"];',
        '    edge [fontname="Helvetica", fontsize=10];',
    ];

    for (const node of graph.nodes) {
        const label = node.kind === "device" ? `${node.label}\n${node.detail[0] ?? ""}` : node.label;
        const mark = markOf(graph, node);
        const color = mark ? `, color=${text(colors[mark])}, penwidth=2` : "";
        lines.push(`    ${text(node.id)} [label=${text(label)}, ${shapes[node.kind]}${color}];`);
    }

    for (const edge of graph.edges) {
        const style = edge.oneSided ? ", style=dashed" : "";
        lines.push(`    ${text(edge.from)} -- ${text(edge.to)} [label=${text(edge.label)}${style}];`);
    }

    lines.push("}");
    return lines.join("\n") + "\n";
}
