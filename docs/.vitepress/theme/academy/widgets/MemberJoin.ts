// What circuit validate and circuit diff printed for each choice in MemberJoin.vue: the internet exchange example with a new member, run once per combination.
// The snapshot diff compares against is the example's own build output, not one read from a device. A file that fails to load stops with Bun's stack trace, of which only the error line is kept.

export type Run = { validate: string; diff?: string };

/** Keyed by asn|ipv4|port. */
export const RUNS: Record<string, Run> = {
    "64501|203.0.113.13|10g-2": {
        validate: "2 device(s), no errors.",
        diff: "ix-sw-01: matches\nix-sw-02: 13 command(s) in 1 step(s)\n  interface 10GE1/0/2\n    - shutdown\n    + description example, AS64501\n    + port default vlan 100\n    + stp disable\n    + storm control broadcast min-rate percent 1 max-rate percent 1\n    + storm control multicast min-rate percent 1 max-rate percent 1\n    + storm control unknown-unicast min-rate percent 1 max-rate percent 1\n    + storm control action suppress\n    + storm control enable trap\n    + storm control enable log\n    + lldp disable",
    },
    "64501|203.0.113.13|10g-1": { validate: "  error  ix-sw-02: port 10g-1 is given to both acme and example\n\n1 error(s)." },
    "64501|203.0.113.13|40g-5": { validate: "error: merge: 40g-5 is declared twice" },
    "64501|203.0.113.12|10g-2": { validate: "  error  203.0.113.12 of example is already acme's\n\n1 error(s)." },
    "64501|203.0.113.12|10g-1": {
        validate:
            "  error  203.0.113.12 of example is already acme's\n  error  ix-sw-02: port 10g-1 is given to both acme and example\n\n2 error(s).",
    },
    "64501|203.0.113.12|40g-5": { validate: "error: merge: 40g-5 is declared twice" },
    "64501|203.0.113.1|10g-2": { validate: "  error  203.0.113.1 of example is already reserved\n\n1 error(s)." },
    "64501|203.0.113.1|10g-1": {
        validate:
            "  error  203.0.113.1 of example is already reserved\n  error  ix-sw-02: port 10g-1 is given to both acme and example\n\n2 error(s).",
    },
    "64501|203.0.113.1|40g-5": { validate: "error: merge: 40g-5 is declared twice" },
    "64501|198.51.100.13|10g-2": { validate: "  error  198.51.100.13 of example is outside the peering LAN\n\n1 error(s)." },
    "64501|198.51.100.13|10g-1": {
        validate:
            "  error  198.51.100.13 of example is outside the peering LAN\n  error  ix-sw-02: port 10g-1 is given to both acme and example\n\n2 error(s).",
    },
    "64501|198.51.100.13|40g-5": { validate: "error: merge: 40g-5 is declared twice" },
    "65550|203.0.113.13|10g-2": { validate: "  error  members acme and example share AS65550\n\n1 error(s)." },
    "65550|203.0.113.13|10g-1": {
        validate:
            "  error  members acme and example share AS65550\n  error  ix-sw-02: port 10g-1 is given to both acme and example\n\n2 error(s).",
    },
    "65550|203.0.113.13|40g-5": { validate: "error: merge: 40g-5 is declared twice" },
    "65550|203.0.113.12|10g-2": {
        validate: "  error  members acme and example share AS65550\n  error  203.0.113.12 of example is already acme's\n\n2 error(s).",
    },
    "65550|203.0.113.12|10g-1": {
        validate:
            "  error  members acme and example share AS65550\n  error  203.0.113.12 of example is already acme's\n  error  ix-sw-02: port 10g-1 is given to both acme and example\n\n3 error(s).",
    },
    "65550|203.0.113.12|40g-5": { validate: "error: merge: 40g-5 is declared twice" },
    "65550|203.0.113.1|10g-2": {
        validate: "  error  members acme and example share AS65550\n  error  203.0.113.1 of example is already reserved\n\n2 error(s).",
    },
    "65550|203.0.113.1|10g-1": {
        validate:
            "  error  members acme and example share AS65550\n  error  203.0.113.1 of example is already reserved\n  error  ix-sw-02: port 10g-1 is given to both acme and example\n\n3 error(s).",
    },
    "65550|203.0.113.1|40g-5": { validate: "error: merge: 40g-5 is declared twice" },
    "65550|198.51.100.13|10g-2": {
        validate:
            "  error  members acme and example share AS65550\n  error  198.51.100.13 of example is outside the peering LAN\n\n2 error(s).",
    },
    "65550|198.51.100.13|10g-1": {
        validate:
            "  error  members acme and example share AS65550\n  error  198.51.100.13 of example is outside the peering LAN\n  error  ix-sw-02: port 10g-1 is given to both acme and example\n\n3 error(s).",
    },
    "65550|198.51.100.13|40g-5": { validate: "error: merge: 40g-5 is declared twice" },
};
