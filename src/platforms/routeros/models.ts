// Port counts per speed class, and how the platform spells a port. `{n}` is the position within the class.
export const models = {
    // A QSFP28 cage is named by cage then lane; an unbroken port is lane 1.
    "CCR2216-1G-12XS-2XQ": {
        ports: { "100g": 2, "25g": 12, "1g": 1 },
        spelling: { "100g": "qsfp28-{n}-1", "25g": "sfp28-{n}", "1g": "ether{n}" },
    },
} as const;
