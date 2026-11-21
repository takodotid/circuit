// The field station's router, a MikroTik RB5009, in the library's stub area for IPv4 only. A radio links it to the observatory and the boathouse, which don't hear each other. The farm's router is on a carrier's line that carries no multicast.

import { campus, classes } from "../../circuit";

export default campus.device({
    name: "field-01",
    site: "field-station",
    role: "Field station router",
    platform: "routeros",
    model: "RB5009UG+S+",
    connection: { host: "10.255.0.3", user: "operator" },

    system: {
        users: { operator: { role: "admin", password: secret("FIELD_01_PASSWORD") } },
    },
    management: { allow: ["10.0.0.0/24"], ssh: {} },

    interfaces: {
        ethernet: {
            "1g-1": { description: "library-01 ether2", addresses: ["10.1.3.2/30"], link: { device: "library-01", port: "1g-1" } },
            "1g-2": { description: "Radio to the observatory and the boathouse", addresses: ["10.1.4.1/28"], scheduler: "radio" },
            "1g-3": { description: "Carrier's line to the farm", addresses: ["10.1.5.1/29"] },
        },
        loopback: { loopback: { addresses: ["10.255.0.3/32"] } },
    },

    routing: {
        router_id: "10.255.0.3",
        ospf: {
            areas: {
                "0.0.0.1": {
                    type: "stub",
                    interfaces: {
                        "1g-1": { network: "point-to-point" },
                        // Each station hears this router but not the other, so OSPF treats the radio as a point-to-point link to each. Anyone in range could send OSPF, so each packet is signed.
                        "1g-2": {
                            network: "point-to-multipoint",
                            authentication: { algorithm: "hmac-sha-256", key_id: 1, key: secret("OSPF_RADIO_KEY") },
                        },
                        // NBMA: OSPF sends its hellos to the farm's router itself, less often, and prefers any other way.
                        "1g-3": { network: "non-broadcast", neighbors: ["10.1.5.2"], hello_interval: 30, dead_interval: 120, cost: 100 },
                        loopback: { passive: true },
                    },
                },
            },
        },
    },

    // #region queues
    // The radio carries 95 Mbit/s, less than the port's 1G, so the router queues what it sends to the radio, where it can choose what goes first. Network control and calls go first, each with a cap, so the rest always gets through. The other classes share what is left.
    qos: {
        classes,
        default_class: "best-effort",
        schedulers: {
            radio: {
                rate: "95M",
                queues: [
                    { class: "network", priority: "strict", max: "5M" },
                    { class: "voice", priority: "strict", max: "20M" },
                    { class: "video", share: 40 },
                    { class: "best-effort", share: 50 },
                    { class: "bulk", share: 10 },
                ],
            },
        },
    },
    // #endregion queues
});
