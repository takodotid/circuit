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

/** One receiver of SNMP traps (RFC 3416). It gets every trap the platform sends. Write `community` for version 2c, or `user` for version 3. */
export type SnmpTrapTarget = {
    /** Where the receiver listens. */
    address: IP;
    /** UDP port. 162 when absent. */
    port?: number;
    /** Version 2c: the community each trap carries. */
    community?: Secret;
    /** Version 3: one of `users`, whose passphrases authenticate and encrypt each trap. */
    user?: string;
};

/** One syslog collector. `C` is the device's certificate names, `F` its VRFs. */
export type SyslogServer<C extends string = string, F extends string = string> = {
    /** Where the collector listens. */
    address: IP;
    /** The VRF the device reaches the collector through, from `routing.vrfs`. The main table when absent. */
    vrf?: F;
    /** The port. 514 when absent, or 6514 with `transport_security`. */
    port?: number;
    /** The least severe message sent. */
    level: Severity;
    /** Send over TLS (RFC 5425) instead of UDP. */
    transport_security?: {
        /** The CA that signed the collector's certificate: one of `system.certificates`, without its private key. */
        ca_certificate: C;
    };
};

/** Export flow records or packet samples to collectors. */
export type FlowExport<I extends string> = {
    /** The record format. */
    protocol: "sflow" | "netflow-v9" | "ipfix";
    /** Where records are sent. */
    collectors: readonly {
        /** Where the collector listens. */
        address: IP;
        /** The UDP port. When absent, 6343 for sFlow and 4739 for IPFIX (their IANA ports), or 2055 for NetFlow v9 (the common choice). */
        port?: number;
    }[];
    /** Sample one packet in this many. When absent, every packet, on a platform that can export every packet. */
    sampling?: number;
    /** The ports and interfaces to watch. Every interface when absent. */
    interfaces?: readonly I[];
    /** Seconds after which a flow still running is exported (RFC 6728 `activeTimeout`). NetFlow v9 and IPFIX only. */
    active_timeout?: number;
    /** Seconds without a packet after which a flow ends and is exported (RFC 6728 `idleTimeout`). NetFlow v9 and IPFIX only. */
    idle_timeout?: number;
};

/**
 * An ICMP echo probe the device runs on its own and keeps the results of: RFC 4560's ping test, which vendors call Netwatch, RPM, NQA, or a link monitor. How many echo requests a test sends, and when the target counts as down, is the platform's own. `F` is the device's VRFs.
 */
export type Probe<F extends string = string> = {
    /** The address the device sends echo requests to (RFC 4560's `pingCtlTargetAddress`). */
    target: IP;
    /** Seconds from one test to the next (RFC 4560's `pingCtlFrequency`). */
    interval: number;
    /** The device's own address the requests come from (RFC 4560's `pingCtlSourceAddress`). The platform picks one when absent. */
    source_address?: IP;
    /** The VRF the device reaches the target through, from `routing.vrfs`. The main table when absent. */
    vrf?: F;
};

/** What the device reports to collectors, and the probes it runs. `I` is the device's ports and interfaces, `C` its certificates, `F` its VRFs. */
export type Monitoring<I extends string, C extends string = string, F extends string = string> = {
    /** SNMP polling. */
    snmp?: Service<F> & {
        /** Read-only community for version 2c. Version 2c is off when absent. */
        community?: Secret;
        /** Version 3 users, keyed by name. */
        users?: Record<string, SnmpUser>;
        /** Who to contact about the device. */
        contact?: string;
        /** Where the device is. */
        location?: string;
        /** Receivers of SNMP traps. */
        traps?: readonly SnmpTrapTarget[];
    };
    /** Log messages sent to syslog collectors, each from its own `level` up. */
    syslog?: readonly SyslogServer<C, F>[];
    /** Flow records or packet samples sent to collectors. */
    flow_export?: FlowExport<I>;
    /** Read the optics' temperature, power, and voltage. */
    transceivers?: boolean;
    /**
     * ICMP echo probes, by the name the device shows each under. Circuit only sets them up: nothing acts on a result. Read them on RouterOS with `/tool netwatch print`, on Junos with `show services rpm probe-results` or SNMP's DISMAN-PING-MIB (owner `circuit`, the name as test), and on FortiOS with `diagnose sys link-monitor status`.
     */
    probes?: Record<string, Probe<F>>;
};
