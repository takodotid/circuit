// Port counts per speed class, and how the platform spells a port. `{n}` is the position within the class; `{n+1}` shifts it, because the platform numbers its copper ports in one run.
export const models = {
    // A QSFP28 cage is named by cage then lane; an unbroken port is lane 1.
    "CCR2216-1G-12XS-2XQ": {
        ports: { "100g": 2, "25g": 12, "1g": 1 },
        spelling: { "100g": "qsfp28-{n}-1", "25g": "sfp28-{n}", "1g": "ether{n}" },
        // Seen on a real device: a LAG with 12 active members crash-looped it, and the switch chip failed at the sixth distinct port range. It held 70 rules with two ranges, so the rule count alone is not the limit.
        limits: { lag_members: 8, switch_port_ranges: 5 },
    },
    // ether1 is the 2.5G port; ether2 to ether8 are 1G.
    "RB5009UG+S+": {
        ports: { "10g": 1, "2.5g": 1, "1g": 7 },
        spelling: { "10g": "sfp-sfpplus{n}", "2.5g": "ether{n}", "1g": "ether{n+1}" },
        // It has no serial port: RouterOS 7.24.6 takes `enter-setup-on` on it, then prints and keeps nothing.
        serial_console: false,
    },
} as const;
