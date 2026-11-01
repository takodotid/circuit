// The network as a graph: the shapes `Topology` draws, without its code, so Studio's page can share them.

/** One view of the network. Every edge belongs to one. */
export type Layer = "l1" | "l2" | "l3" | "bgp" | "ospf" | "tunnels";

/** One of our devices, a segment several of them share, or something outside the network. */
export type GraphNode = {
    /** Unique among the nodes, such as `device:edge-01` or `as:64501`. */
    id: string;
    kind: "device" | "segment" | "outside";
    /** A word or two, drawn on the node. */
    label: string;
    /** One fact per line, for a closer look. */
    detail: string[];
};

/** A VLAN a cable carries. */
export type CarriedVlan = {
    name: string;
    id: number;
    /** Carried without a tag: the access VLAN, or a trunk's native VLAN. */
    untagged: boolean;
};

export type GraphEdge = {
    layer: Layer;
    /** Node ids. */
    from: string;
    to: string;
    /** A few words, drawn on the edge. */
    label: string;
    /** One fact per line, for a closer look. */
    detail: string[];
    /** Only one end declares it: the far device does not declare the cable, session or tunnel back. */
    oneSided?: true;
    /** On `l2`, the VLANs the cable carries. */
    vlans?: CarriedVlan[];
};

export type Graph = { nodes: GraphNode[]; edges: GraphEdge[] };
