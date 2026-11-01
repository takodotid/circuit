// Port counts per speed class, and how the platform spells a port. `{n}` is the position within the class; `{n+4}` shifts it, because the platform numbers every data port in one run. The out-of-band management ports are the `1g` class.
export const models = {
    "FG-3700D": {
        ports: { "40g": 4, "10g": 28, "1g": 2 },
        spelling: { "40g": "port{n}", "10g": "port{n+4}", "1g": "mgmt{n}" },
    },
} as const;
