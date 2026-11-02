// What circuit validate and circuit diff printed for each choice in TenantJoin.vue: the colocation example with a second tenant, globex, run once per combination.
// Each diff is planned against the example as it is, rendered, not against a device.

export type Run = { validate: string; diff?: string };

/** Keyed by vlan|block|port|networks. */
export const RUNS: Record<string, Run> = {
    "1002|free|10g-3|internet": {
        validate: "✔ 2 device(s), no errors.",
        diff: "$ circuit diff edge-01\nedge-01: 4 command(s) in 4 step(s)\n  /interface vlan\n    + add comment=Tenant globex interface=bridge name=globex-internet vlan-id=1002\n  /interface bridge vlan\n    + add bridge=bridge comment=Tenant globex internet tagged=bridge,qsfp28-1-1 vlan-ids=1002\n  /ip address\n    + add address=198.51.100.17/29 comment=Tenant globex interface=globex-internet\n  /ipv6 address\n    + add address=2001:db8:100:2::1/64 advertise=no comment=Tenant globex interface=globex-internet\n$ circuit diff tor-01\ntor-01: 14 command(s) in 4 step(s)\n  vlan 1002\n    + name globex-internet\n    + description Tenant globex internet\n  (top level)\n    + vlan batch 1002\n  interface 10GE1/0/3\n    - shutdown\n    + description globex server 1\n    + port default vlan 1002\n  interface 40GE1/0/1\n    - port trunk allow-pass vlan 99 1001\n    + port trunk allow-pass vlan 99 1001 to 1002",
    },
    "1002|free|10g-3|both": {
        validate: "✔ 2 device(s), no errors.",
        diff: "$ circuit diff edge-01\nedge-01: 4 command(s) in 4 step(s)\n  /interface vlan\n    + add comment=Tenant globex interface=bridge name=globex-internet vlan-id=1002\n  /interface bridge vlan\n    + add bridge=bridge comment=Tenant globex internet tagged=bridge,qsfp28-1-1 vlan-ids=1002\n  /ip address\n    + add address=198.51.100.17/29 comment=Tenant globex interface=globex-internet\n  /ipv6 address\n    + add address=2001:db8:100:2::1/64 advertise=no comment=Tenant globex interface=globex-internet\n$ circuit diff tor-01\ntor-01: 20 command(s) in 5 step(s)\n  vlan 1002\n    + name globex-internet\n    + description Tenant globex internet\n  vlan 2002\n    + name globex-private\n    + description Tenant globex private\n  (top level)\n    + vlan batch 1002 2002\n  interface 10GE1/0/3\n    - shutdown\n    + description globex server 1\n    + port link-type trunk\n    + undo port trunk allow-pass vlan 1\n    + port trunk allow-pass vlan 1002 2002\n  interface 40GE1/0/1\n    - port trunk allow-pass vlan 99 1001\n    + port trunk allow-pass vlan 99 1001 to 1002",
    },
    "1002|free|10g-1|internet": {
        validate:
            'tenants/index.ts:4: merge: parts.tor-01.interfaces.ethernet.10g-1.description is written twice with two values: "acme server 1" in tenants/acme.ts:24, and "globex server 1" in tenants/globex.ts:17. One name holds one value: rename one, or make both the same.\n\n1 error(s).',
    },
    "1002|free|10g-1|both": {
        validate:
            'tenants/index.ts:4: merge: parts.tor-01.interfaces.ethernet.10g-1.description is written twice with two values: "acme server 1" in tenants/acme.ts:24, and "globex server 1" in tenants/globex.ts:17. One name holds one value: rename one, or make both the same.\n\n1 error(s).',
    },
    "1002|overlap|10g-3|internet": {
        validate:
            "tenants/globex.ts:13: blocks_apart: edge-01: interfaces.vlan_interface.globex-internet: 198.51.100.13/30 overlaps 198.51.100.9/29 on acme-internet. Give each its own block.\n\n1 error(s).",
    },
    "1002|overlap|10g-3|both": {
        validate:
            "tenants/globex.ts:13: blocks_apart: edge-01: interfaces.vlan_interface.globex-internet: 198.51.100.13/30 overlaps 198.51.100.9/29 on acme-internet. Give each its own block.\n\n1 error(s).",
    },
    "1002|overlap|10g-1|internet": {
        validate:
            'tenants/index.ts:4: merge: parts.tor-01.interfaces.ethernet.10g-1.description is written twice with two values: "acme server 1" in tenants/acme.ts:24, and "globex server 1" in tenants/globex.ts:17. One name holds one value: rename one, or make both the same.\n\n1 error(s).',
    },
    "1002|overlap|10g-1|both": {
        validate:
            'tenants/index.ts:4: merge: parts.tor-01.interfaces.ethernet.10g-1.description is written twice with two values: "acme server 1" in tenants/acme.ts:24, and "globex server 1" in tenants/globex.ts:17. One name holds one value: rename one, or make both the same.\n\n1 error(s).',
    },
    "1001|free|10g-3|internet": {
        validate:
            "  error  edge-01: switching.vlans acme-internet and globex-internet share id 1001\n  error  tor-01: switching.vlans acme-internet and globex-internet share id 1001\n\n2 error(s).",
    },
    "1001|free|10g-3|both": {
        validate:
            "  error  edge-01: switching.vlans acme-internet and globex-internet share id 1001\n  error  tor-01: switching.vlans acme-internet and globex-internet share id 1001\n  error  tor-01: switching.vlans acme-private and globex-private share id 2001\n\n3 error(s).",
    },
    "1001|free|10g-1|internet": {
        validate:
            'tenants/index.ts:4: merge: parts.tor-01.interfaces.ethernet.10g-1.description is written twice with two values: "acme server 1" in tenants/acme.ts:24, and "globex server 1" in tenants/globex.ts:17. One name holds one value: rename one, or make both the same.\n\n1 error(s).',
    },
    "1001|free|10g-1|both": {
        validate:
            'tenants/index.ts:4: merge: parts.tor-01.interfaces.ethernet.10g-1.description is written twice with two values: "acme server 1" in tenants/acme.ts:24, and "globex server 1" in tenants/globex.ts:17. One name holds one value: rename one, or make both the same.\n\n1 error(s).',
    },
    "1001|overlap|10g-3|internet": {
        validate:
            "tenants/globex.ts:13: blocks_apart: edge-01: interfaces.vlan_interface.globex-internet: 198.51.100.13/30 overlaps 198.51.100.9/29 on acme-internet. Give each its own block.\n\n1 error(s).",
    },
    "1001|overlap|10g-3|both": {
        validate:
            "tenants/globex.ts:13: blocks_apart: edge-01: interfaces.vlan_interface.globex-internet: 198.51.100.13/30 overlaps 198.51.100.9/29 on acme-internet. Give each its own block.\n\n1 error(s).",
    },
    "1001|overlap|10g-1|internet": {
        validate:
            'tenants/index.ts:4: merge: parts.tor-01.interfaces.ethernet.10g-1.description is written twice with two values: "acme server 1" in tenants/acme.ts:24, and "globex server 1" in tenants/globex.ts:17. One name holds one value: rename one, or make both the same.\n\n1 error(s).',
    },
    "1001|overlap|10g-1|both": {
        validate:
            'tenants/index.ts:4: merge: parts.tor-01.interfaces.ethernet.10g-1.description is written twice with two values: "acme server 1" in tenants/acme.ts:24, and "globex server 1" in tenants/globex.ts:17. One name holds one value: rename one, or make both the same.\n\n1 error(s).',
    },
};
