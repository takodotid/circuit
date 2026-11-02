// What circuit validate and circuit diff printed for each choice in MemberJoin.vue: the internet exchange example with a new member, fastly, run once per combination.
// Each diff is planned against the example as it is, rendered, not against a device.

export type Run = { validate: string; diff?: string };

/** Keyed by asn|port. */
export const RUNS: Record<string, Run> = {
    "54113|10g-2": {
        validate: "✔ 2 device(s), no errors.",
        diff: "$ circuit diff ix-sw-02\nix-sw-02: 15 command(s) in 1 step(s)\n  interface 10GE1/0/2\n    - shutdown\n    + description Fastly, AS54113\n    + port default vlan 100\n    + stp disable\n    + storm control broadcast min-rate percent 1 max-rate percent 1\n    + storm control multicast min-rate percent 1 max-rate percent 1\n    + storm control unknown-unicast min-rate percent 1 max-rate percent 1\n    + storm control action suppress\n    + storm control enable trap\n    + storm control enable log\n    + lldp disable\n    + mac-address limit maximum 1\n    + traffic-filter acl 4000 inbound",
    },
    "54113|40g-1": {
        validate:
            'members/index.ts:5: merge: parts.ix-sw-02.interfaces.ethernet.40g-1.description is written twice with two values: "Google, AS15169" in members/google.ts:7, and "Fastly, AS54113" in members/fastly.ts:5. One name holds one value: rename one, or make both the same.\n\n1 error(s).',
    },
    "54113|40g-5": {
        validate:
            'sites/ix-1/ix-sw-02.ts:7: interfaces.ethernet.40g-5.description is written twice with two values: "ix-sw-01 40GE1/0/5" in sites/ix-1/ix-sw-02.ts:7, and "Fastly, AS54113" in members/fastly.ts:5. One name holds one value: rename one, or make both the same.\n\n1 error(s).',
    },
    "13335|10g-2": {
        validate: "✔ 2 device(s), no errors.",
        diff: "$ circuit diff ix-sw-02\nix-sw-02: 15 command(s) in 1 step(s)\n  interface 10GE1/0/2\n    - shutdown\n    + description Fastly, AS13335\n    + port default vlan 100\n    + stp disable\n    + storm control broadcast min-rate percent 1 max-rate percent 1\n    + storm control multicast min-rate percent 1 max-rate percent 1\n    + storm control unknown-unicast min-rate percent 1 max-rate percent 1\n    + storm control action suppress\n    + storm control enable trap\n    + storm control enable log\n    + lldp disable\n    + mac-address limit maximum 1\n    + traffic-filter acl 4000 inbound",
    },
    "13335|40g-1": {
        validate:
            'members/index.ts:5: merge: parts.ix-sw-02.interfaces.ethernet.40g-1.description is written twice with two values: "Google, AS15169" in members/google.ts:7, and "Fastly, AS13335" in members/fastly.ts:5. One name holds one value: rename one, or make both the same.\n\n1 error(s).',
    },
    "13335|40g-5": {
        validate:
            'sites/ix-1/ix-sw-02.ts:7: interfaces.ethernet.40g-5.description is written twice with two values: "ix-sw-01 40GE1/0/5" in sites/ix-1/ix-sw-02.ts:7, and "Fastly, AS13335" in members/fastly.ts:5. One name holds one value: rename one, or make both the same.\n\n1 error(s).',
    },
};
