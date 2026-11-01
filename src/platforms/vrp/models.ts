// Port counts per speed class, and how the platform spells a port. `{n}` is the position within the class.
export const models = {
    "CE6855-48S6Q-HI": { ports: { "10g": 48, "40g": 6 }, spelling: { "10g": "10GE1/0/{n}", "40g": "40GE1/0/{n}" } },
} as const;
