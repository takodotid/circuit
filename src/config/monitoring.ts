// What the box reports to collectors: `monitoring.snmp`, `.syslog`, `.flow_export`, `.transceivers`.

import type { IP, Secret, Severity } from "./common";
import type { Service } from "./management";

/** One SNMPv3 user. */
export type SnmpUser = {
    /** How messages are authenticated. */
    auth: "sha1" | "sha256";
    /** The authentication passphrase. */
    auth_password: Secret;
    /** How messages are encrypted. */
    privacy: "aes128" | "des";
    /** The encryption passphrase. */
    privacy_password: Secret;
};

/** One syslog collector. */
export type SyslogServer = {
    /** Where the collector listens. */
    address: IP;
    /** UDP port. 514 when absent. */
    port?: number;
    /** The least severe message sent. */
    level: Severity;
};

/** Export flow records or packet samples to collectors. */
export type FlowExport<I extends string> = {
    /** The record format. */
    protocol: "sflow" | "netflow-v9" | "ipfix";
    /** Where records are sent. */
    collectors: readonly {
        /** Where the collector listens. */
        address: IP;
        /** UDP port. When absent: 6343 for sFlow and 4739 for IPFIX (IANA), 2055 for NetFlow v9 (the usual one). */
        port?: number;
    }[];
    /** Sample one packet in this many. Every packet when absent, on a platform that can export every packet. */
    sampling?: number;
    /** Some of the device's ports and interfaces: where traffic is observed. Every interface when absent. */
    interfaces?: readonly I[];
};

/** What the device reports to collectors. `I` is the device's ports and interfaces. */
export type Monitoring<I extends string> = {
    /** Polling by SNMP. */
    snmp?: Service & {
        /** Read-only community for version 2c. Version 2c is off when absent. */
        community?: Secret;
        /** Version 3 users, keyed by name. */
        users?: Record<string, SnmpUser>;
        /** Who to contact about the device. */
        contact?: string;
        /** Where the device is. */
        location?: string;
    };
    /** Log messages sent to syslog collectors, each from its own `level` up. */
    syslog?: readonly SyslogServer[];
    /** Flow records or packet samples sent to collectors. */
    flow_export?: FlowExport<I>;
    /** Read optic temperature, power and voltage. */
    transceivers?: boolean;
};
