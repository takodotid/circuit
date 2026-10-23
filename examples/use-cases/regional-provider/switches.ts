// What every switch shares: logins, the ways in, time, and the VLANs each site trunks between its switches.

import type { Vlan } from "@takodotid/circuit";
import { secret } from "@takodotid/circuit";
import { AT } from "./customers";
import { ADMIN, SERVICES } from "./network";
import { customerVlanNames } from "./tenancy";

export const users = {
    operator: { role: "admin", password: secret("SWITCH_OPERATOR_PASSWORD") },
} as const;

export const system = { timezone: "Asia/Jakarta", ntp: { servers: SERVICES.ntp } } as const;

// Every service on a switch takes its sources from management.allow.
const snmp = {
    users: {
        monitor: {
            auth: "sha1",
            auth_password: secret("SWITCH_SNMP_AUTH"),
            privacy: "aes128",
            privacy_password: secret("SWITCH_SNMP_PRIVACY"),
        },
    },
} as const;

/** Ways in on a VRP switch. */
export const vrpManagement = (location: string) => ({ allow: ADMIN, ssh: {}, snmp: { ...snmp, location } }) as const;

/** Ways in on a Raisecom switch, which also asks for a password to enter privileged mode. */
export const raisecomManagement = {
    allow: ADMIN,
    ssh: { auth_timeout: 60, auth_retries: 3 },
    privilege_password: secret("SWITCH_ENABLE_PASSWORD"),
    snmp,
} as const;

/** VLANs without their descriptions, for a Raisecom switch, which has nowhere to keep one. */
export const undescribed = (vlans: Record<string, Vlan>): Record<string, Vlan> =>
    Object.fromEntries(Object.entries(vlans).map(([name, vlan]) => [name, { id: vlan.id }]));

/** What site A's core switches trunk to the edge routers. */
export const SITE_A_EDGE = ["mgmt", "infra", ...customerVlanNames(AT.a)];

/** What site A's core switches trunk to each other: the edge's VLANs and the services VLAN. */
export const SITE_A_CORE = [...SITE_A_EDGE, "services"];

/** What site A's core switches trunk to the top-of-rack switches. */
export const SITE_A_TOR = ["mgmt", ...customerVlanNames(AT.a)];

/** What every trunk at site B carries. */
export const SITE_B = ["mgmt", "infra", "office", ...customerVlanNames(AT.b)];
