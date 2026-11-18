// What one layer of the graph shows: its nodes and lines, with ids that stay. Many lines between two nodes are drawn as one. A comparison shows lines added and gone, with the nodes gone at their ends.

import { describe, expect, test } from "bun:test";
import type { GraphEdge, GraphNode } from "../../src/core/graph";
import { GraphLayer } from "../../src/studio/app/src/lib/graph-layer";
import type { StudioData } from "../../src/studio/types";

const device = (name: string): GraphNode => ({ id: `device:${name}`, kind: "device", label: name, detail: [] });
const cable = (from: string, to: string, label: string): GraphEdge => ({
    layer: "l1",
    from: `device:${from}`,
    to: `device:${to}`,
    label,
    detail: [`${from} to ${to}`],
});

function data(edges: GraphEdge[], nodes: GraphNode[] = [device("edge-01"), device("tor-01"), device("tor-02")]): StudioData {
    return {
        graph: { nodes, edges },
        findings: [{ level: "error", device: "tor-01", message: "something is wrong" }],
    } as unknown as StudioData;
}

describe("a layer of the graph", () => {
    test("shows every device and what its lines end at, each line by an id that stays", () => {
        const outside: GraphNode = { id: "as:6939", kind: "outside", label: "AS6939", detail: ["Hurricane Electric"] };
        const session: GraphEdge = { layer: "bgp", from: "device:edge-01", to: "as:6939", label: "transit", detail: [] };
        const shown = GraphLayer.of(
            data([session, cable("edge-01", "tor-01", "1 to 1")], [device("edge-01"), device("tor-01"), outside]),
            "bgp"
        );

        expect(shown.nodes.map((node) => node.id)).toEqual(["device:edge-01", "device:tor-01", "as:6939"]);
        expect(shown.edges.map((edge) => edge.id)).toEqual(["bgp device:edge-01 as:6939 transit"]);
        expect(shown.nodes.find((node) => node.id === "device:tor-01")?.level).toBe("error");
    });

    test("tells two lines alike apart", () => {
        const shown = GraphLayer.of(data([cable("edge-01", "tor-01", "same"), cable("edge-01", "tor-01", "same")]), "l1");

        expect(shown.edges.map((edge) => edge.id)).toEqual([
            "l1 device:edge-01 device:tor-01 same",
            "l1 device:edge-01 device:tor-01 same (2)",
        ]);
    });

    test("draws more than three lines between two nodes as one that lists them", () => {
        const four = ["1", "2", "3", "4"].map((port) => cable("edge-01", "tor-01", `${port} to ${port}`));
        const three = ["1", "2", "3"].map((port) => cable("edge-01", "tor-02", `${port} to ${port}`));
        const shown = GraphLayer.of(data([...four, ...three]), "l1");

        const bundle = shown.edges.find((edge) => edge.members);
        expect(bundle?.label).toBe("4 cables");
        expect(bundle?.members?.map((member) => member.label)).toEqual(["1 to 1", "2 to 2", "3 to 3", "4 to 4"]);
        expect(bundle?.keys).toHaveLength(4);
        expect(shown.edges.filter((edge) => edge.to === "device:tor-02")).toHaveLength(3);
    });

    test("marks a comparison's new lines, and draws the lines gone back, with an end that is gone too", () => {
        const kept = cable("edge-01", "tor-01", "1 to 1");
        const added = cable("edge-01", "tor-02", "2 to 1");
        const gone = cable("tor-01", "tor-02", "5 to 5");
        const goneWithItsDevice = cable("edge-01", "tor-09", "3 to 1");

        const shown = GraphLayer.of(data([kept, added]), "l1", {
            name: "main",
            added: [added],
            removed: [gone, goneWithItsDevice],
            removedNodes: [device("tor-09")],
        });

        expect(shown.edges.map((edge) => [edge.label, Boolean(edge.added), Boolean(edge.gone)])).toEqual([
            ["1 to 1", false, false],
            ["2 to 1", true, false],
            ["5 to 5", false, true],
            ["3 to 1", false, true],
        ]);
        expect(shown.nodes.map((node) => [node.id, Boolean(node.gone)])).toEqual([
            ["device:edge-01", false],
            ["device:tor-01", false],
            ["device:tor-02", false],
            ["device:tor-09", true],
        ]);
    });

    test("draws a node that is gone only on a layer where a line gone ends at it", () => {
        const goneWithItsDevice = cable("edge-01", "tor-09", "3 to 1");
        const comparison = { name: "main", added: [], removed: [goneWithItsDevice], removedNodes: [device("tor-09")] };

        expect(GraphLayer.of(data([]), "bgp", comparison).nodes.map((node) => node.id)).toEqual([
            "device:edge-01",
            "device:tor-01",
            "device:tor-02",
        ]);
    });
});
