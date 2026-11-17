// What one layer of the graph shows: its lines, every device, and whatever else its lines end at. Each part has an id that stays the same while the project changes, so the drawing keeps its places and what is selected.

import type { GraphEdge, GraphNode, Layer } from "../../../../core/graph";
import type { StudioData } from "../../../types";

/** A node as drawn, with what `circuit validate` finds on its device. */
export type ShownNode = GraphNode & { level?: "error" | "warning" };

/** A line as drawn: one of the graph's, or, in a comparison, one that is new or one that is gone, drawn back. */
export type ShownEdge = GraphEdge & {
    id: string;
    /** The lines it stands for, by `keyOf`. */
    keys: string[];
    added?: true;
    gone?: true;
};

export type Shown = { nodes: ShownNode[]; edges: ShownEdge[] };

/** Another commit's graph against this one, as Compare finds it. */
export type Comparison = { name: string; added: GraphEdge[]; removed: GraphEdge[] };

export class GraphLayer {
    static readonly LAYERS: readonly Layer[] = ["l1", "l2", "l3", "bgp", "ospf", "tunnels"];

    static readonly NAMES: Record<Layer, string> = {
        l1: "Cables",
        l2: "VLANs",
        l3: "Addresses",
        bgp: "BGP",
        ospf: "OSPF",
        tunnels: "Tunnels",
    };

    static readonly HELP: Record<Layer, string> = {
        l1: "Each cable a port's link names. A LAG's cables are one line.",
        l2: "The VLANs each cable carries. Pick a VLAN to light its cables.",
        l3: "Prefixes two devices share. Three or more share a segment, drawn as a box.",
        bgp: "Sessions between our devices, and to each AS outside.",
        ospf: "Interfaces in one area and one prefix, neither passive.",
        tunnels: "GRE and VXLAN tunnels, and WireGuard peers.",
    };

    /** What one line and many lines are called on each layer. */
    static readonly LINES: Record<Layer, [string, string]> = {
        l1: ["cable", "cables"],
        l2: ["cable", "cables"],
        l3: ["shared prefix", "shared prefixes"],
        bgp: ["session", "sessions"],
        ospf: ["adjacency", "adjacencies"],
        tunnels: ["tunnel", "tunnels"],
    };

    static isLayer(name: string | undefined): name is Layer {
        return GraphLayer.LAYERS.includes(name as Layer);
    }

    /** "1 cable", "3 sessions". */
    static count(layer: Layer, count: number): string {
        const [one, many] = GraphLayer.LINES[layer];
        return `${count} ${count === 1 ? one : many}`;
    }

    /** A line by what it is, the same while the project changes. */
    static keyOf(edge: GraphEdge): string {
        return `${edge.layer} ${edge.from} ${edge.to} ${edge.label}`;
    }

    private static levelOf(data: StudioData, node: GraphNode): ShownNode["level"] {
        if (node.kind !== "device") return undefined;

        const findings = data.findings.filter((finding) => finding.device === node.label);
        if (findings.some((finding) => finding.level === "error")) return "error";
        return findings.length ? "warning" : undefined;
    }

    /** What a layer shows. With a comparison, its new lines are marked, and the lines it lost are drawn back where both ends still are. */
    static of(data: StudioData, layer: Layer, comparison?: Comparison): Shown {
        const added = new Set(comparison?.added.map(GraphLayer.keyOf));
        const nodeIds = new Set(data.graph.nodes.map((node) => node.id));
        const gone = (comparison?.removed ?? []).filter((edge) => edge.layer === layer && nodeIds.has(edge.from) && nodeIds.has(edge.to));

        const lines = [
            ...data.graph.edges.filter((edge) => edge.layer === layer).map((edge) => ({ edge, gone: false })),
            ...gone.map((edge) => ({ edge, gone: true })),
        ];

        // Two lines alike, such as two cables with the same label, are told apart by a number.
        const seen = new Map<string, number>();
        const edges = lines.map(({ edge, gone }) => {
            const key = GraphLayer.keyOf(edge);
            const id = `${gone ? "gone " : ""}${key}`;
            const times = (seen.get(id) ?? 0) + 1;
            seen.set(id, times);

            return {
                ...edge,
                id: times === 1 ? id : `${id} (${times})`,
                keys: [key],
                ...(gone ? { gone: true as const } : {}),
                ...(!gone && added.has(key) ? { added: true as const } : {}),
            };
        });

        const ends = new Set(edges.flatMap((edge) => [edge.from, edge.to]));
        const nodes = data.graph.nodes
            .filter((node) => node.kind === "device" || ends.has(node.id))
            .map((node) => {
                const level = GraphLayer.levelOf(data, node);
                return { ...node, ...(level ? { level } : {}) };
            });

        return { nodes, edges };
    }
}
