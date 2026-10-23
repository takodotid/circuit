// Port counts per speed class, and how the platform spells a port. `{n}` is the position within the class.
export const models = {
    // A QSFP28 cage is named by cage then lane; an unbroken port is lane 1.
    "CCR2216-1G-12XS-2XQ": {
        ports: { "100g": 2, "25g": 12, "1g": 1 },
        spelling: { "100g": "qsfp28-{n}-1", "25g": "sfp28-{n}", "1g": "ether{n}" },
        // Seen on a real device: a LAG with 12 active members crash-looped it. The switch chip held about 50 switch rules, not the 1,024 listed, and failed at the sixth distinct port range.
        limits: { lag_members: 8, switch_rules: 50, switch_port_ranges: 5 },
    },
} as const;
