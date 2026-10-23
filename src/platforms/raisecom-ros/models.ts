// Port counts per speed class, and how the platform spells a port. `{n}` is the position within the class. The out-of-band management port is not a switch port and is left out.
export const models = {
    "RAX721-C-6C48": {
        ports: { "100g": 6, "25g": 24, "10g": 24 },
        spelling: { "100g": "hundredgige 1/1/{n}", "25g": "twenty-fivegige 1/2/{n}", "10g": "tengigabitethernet 1/3/{n}" },
    },
} as const;
