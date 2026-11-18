// What one layer of the graph shows: its nodes and lines with ids that stay, many lines between two nodes drawn as one, and a comparison's lines added and gone.

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
        const outside: GraphNode = { id: "as:6939", kind: "outside", label: "AS6939", detail: [] };
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

    test("marks a comparison's new lines, and draws the lines gone back while both ends are there", () => {
        const kept = cable("edge-01", "tor-01", "1 to 1");
        const added = cable("edge-01", "tor-02", "2 to 1");
        const gone = cable("tor-01", "tor-02", "5 to 5");
        const goneWithItsDevice = cable("edge-01", "tor-09", "3 to 1");

        const shown = GraphLayer.of(data([kept, added]), "l1", { name: "main", added: [added], removed: [gone, goneWithItsDevice] });

        expect(shown.edges.map((edge) => [edge.label, Boolean(edge.added), Boolean(edge.gone)])).toEqual([
            ["1 to 1", false, false],
            ["2 to 1", true, false],
            ["5 to 5", false, true],
        ]);
    });
});
