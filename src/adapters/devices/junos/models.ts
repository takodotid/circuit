// Port counts per speed class, and how the platform spells a port. `{n}` is the position within the class; `{n-1}` and `{n+47}` shift it, because the platform counts every port of a switch from 0. The out-of-band management ports are the `1g` class: they route, and switch nothing.
export const models = {
    "QFX5100-48S-6Q": {
        ports: { "40g": 6, "10g": 48, "1g": 2 },
        spelling: { "40g": "et-0/0/{n+47}", "10g": "xe-0/0/{n-1}", "1g": "em{n-1}" },
    },
} as const;
