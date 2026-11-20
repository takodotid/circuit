// The router of hall 2, a CloudEngine switch. edge-01 reflects our routes to it, and it hands edge-01 the routes of the hall's transit customer, AS64501, which announces its own block over BGP.

import { as64500 } from "../../circuit";
import { dc_1 } from "./site";

export default as64500.device({
    name: "hall-2",
    site: "dc-1",
    role: "Hall router",
    platform: "vrp",
    model: "CE6855-48S6Q-HI",
    connection: { host: "10.0.1.2", user: "operator" },

    system: {
        timezone: dc_1.timezone,
        users: { operator: { role: "admin", password: secret("HALL_2_PASSWORD") } },
    },
    management: { allow: [dc_1.addresses.management], ssh: {} },

    // A switch routes between VLAN interfaces, so each routed port is in a VLAN of its own.
    interfaces: {
        ethernet: {
            "40g-1": { description: "edge-01, routers of halls 2 and 3", access_vlan: "core" },
            "10g-1": { description: "AS64501", access_vlan: "as64501" },
        },
        vlan_interface: {
            core: { vlan: "core", addresses: ["10.0.1.2/29"] },
            as64501: { vlan: "as64501", description: "AS64501", addresses: ["198.51.100.249/30"] },
        },
    },
    switching: {
        vlans: {
            core: { id: 10, description: "edge-01 and the halls' routers" },
            as64501: { id: 101, description: "AS64501, a transit customer" },
        },
    },

    routing: {
        router_id: "10.0.1.2",
        static_routes: [{ prefix: presets.default_routes.ipv4, next_hop: "10.0.1.1" }],
        bgp: {
            neighbors: {
                // A route reflector client: it needs no session with hall 3's router (RFC 4456).
                "edge-01": {
                    address: "10.0.1.1",
                    remote_as: 64500,
                    description: "edge-01, the route reflector",
                    import_policy: "from-edge",
                    export_policy: "to-edge",
                },
                as64501: {
                    address: "198.51.100.250",
                    remote_as: 64501,
                    description: "AS64501, a transit customer",
                    password: secret("AS64501_BGP_KEY"),
                    max_prefixes: 10,
                    import_policy: "as64501-import",
                    export_policy: "as64501-export",
                },
            },
        },
        prefix_sets: {
            ours: { prefixes: as64500.prefixes.ours },
        },
        policies: {
            // AS64501 announces the block we gave it itself, or for one of its own customers, AS64502 to AS64505. Its routes are tagged as a customer's.
            "as64501-import": [
                {
                    description: "The block we gave it",
                    if: { prefix: "198.51.100.128/26", origin_as: [64501, { min: 64502, max: 64505 }] },
                    set: { add_standard_communities: ["64500:300"] },
                    then: "accept",
                },
                { then: "reject" },
            ],
            "as64501-export": [{ description: "Our own space", if: { prefix_set: "ours" }, then: "accept" }, { then: "reject" }],
            "from-edge": [{ description: "Our own space", if: { prefix_set: "ours" }, then: "accept" }, { then: "reject" }],
            // Only a customer's routes go to edge-01, by their tag.
            "to-edge": [{ description: "Customers' routes", if: { standard_community: "64500:300" }, then: "accept" }, { then: "reject" }],
        },
    },
});
