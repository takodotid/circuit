// A firewall in transparent mode, a bridge between two VLANs on one LAG, reached only through its console. Not a real network.

import { defineDevice, secret } from "@takodotid/circuit";

export default defineDevice({
    name: "example-transparent-firewall",
    platform: "fortios",
    model: "FG-3700D",
    connection: {
        user: "netops",
        console: { port: "/dev/serial/by-path/pci-0000:00:14.0-usb-0:2.4:1.0-port0", baud: 9600 },
    },
    users: { netops: { role: "admin", password: secret("EXAMPLE_NETOPS_PASSWORD") } },

    vlans: { outside: { id: 3901 }, inside: { id: 3902 } },

    ports: {
        "10g-1": { description: "Router", lag: "router" },
        "10g-2": { description: "Router", lag: "router" },
    },

    interfaces: {
        router: { type: "lag", mode: "lacp", trunk_vlans: ["outside", "inside"] },
        outside: { type: "vlan", vlan: "outside", description: "From the router's gateway" },
        inside: { type: "vlan", vlan: "inside", description: "Toward the servers" },
        scrub: { type: "bridge", description: "Filtered between outside and inside", members: ["outside", "inside"] },
    },

    firewall: {
        filter: {
            forward: {
                default: "drop",
                rules: [
                    { description: "Into the servers", match: { in_interface: "outside", out_interface: "inside" }, action: "accept" },
                    { description: "Out of the servers", match: { in_interface: "inside", out_interface: "outside" }, action: "accept" },
                ],
            },
        },
    },
});
