import type { IP, Prefix, Secret, Severity } from "./common";

/** Device-wide settings. */
export type System = {
    /** IANA zone, for example `Asia/Jakarta`. UTC when absent. */
    timezone?: string;
    /** Shown at login. */
    banner?: string;
    /** Resolvers the device uses. */
    dns?: {
        /** Resolvers, in order of preference. */
        servers: readonly IP[];
        /** Answer queries from others. Off when absent. */
        serve?: boolean;
    };
    /** Time the device keeps. */
    ntp?: {
        /** Time sources, by address or name. */
        servers: readonly string[];
        /** Answer time queries from others. Off when absent. */
        serve?: boolean;
    };
    /** Where log messages go. */
    logging?: {
        /** Kept on the device's own storage, from `level` up. */
        local?: {
            /** The least severe message kept. */
            level: Severity;
            /** How many rotated files to keep. */
            files?: number;
            /** Lines in each file before it rotates. */
            lines_per_file?: number;
        };
        /** Sent to syslog collectors, each from its own `level` up. */
        remote?: readonly {
            address: IP;
            /** UDP port. 514 when absent. */
            port?: number;
            /** The least severe message sent. */
            level: Severity;
        }[];
    };
    /** Software release track the device updates from. */
    release_channel?: string;
    /** Read optic temperature, power and voltage. */
    transceiver_monitoring?: boolean;
    /** Host behaviour of the IP stack. */
    ip?: {
        /** Send ICMP redirects. Off when absent. */
        icmp_redirects?: boolean;
        /** Answer a TCP SYN flood with SYN cookies. Off when absent. */
        syn_cookies?: boolean;
    };
};

/** A login on the device. */
export type User = {
    /** What the user may do. */
    role: "admin" | "operator" | "read-only";
    /** The login password. */
    password: Secret;
    /** Who the account is for. */
    description?: string;
    /** Public keys accepted instead of the password over SSH. */
    ssh_keys?: readonly string[];
};

/** A way into the device. Absent means turned off. */
export type Service = {
    /** Sources allowed. `management.allow` when absent. */
    allow?: readonly Prefix[];
    /** TCP or UDP port. The protocol's own when absent. */
    port?: number;
};

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

/** How the device is reached and managed. */
export type Management<I extends string, C extends string> = {
    /** Sources allowed to every service that does not state its own. */
    allow?: readonly Prefix[];
    /** Secure shell. */
    ssh?: Service & {
        /** Also offer legacy ciphers, MACs and key exchanges. Off when absent. */
        weak_crypto?: boolean;
        /** Seconds a login may take. */
        auth_timeout?: number;
        /** Failed attempts allowed per connection. */
        auth_retries?: number;
    };
    /** Unencrypted remote login. */
    telnet?: Service;
    /** Web interface, unencrypted. */
    http?: Service;
    /** Web interface over TLS. */
    https?: Service & {
        /** One of the device's `certificates`. */
        certificate?: C;
    };
    /** The platform's own API, unencrypted. */
    api?: Service;
    /** The platform's own API over TLS. */
    api_tls?: Service & {
        /** One of the device's `certificates`. */
        certificate?: C;
    };
    /** File transfer, unencrypted. */
    ftp?: Service;
    /** The platform's own management protocol. `interfaces` also allows it at layer 2 on those interfaces. */
    native?: Service & { interfaces?: readonly I[] };
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
    /** Console login uses this password. The device's users when absent. */
    console?: { password: Secret };
    /** Password for privileged mode, on platforms that have one. */
    privilege_password?: Secret;
};

/** A DHCP server for one network. */
export type DhcpServer<I extends string> = {
    /** Where it answers. */
    interface: I;
    /** The network it serves. */
    network: Prefix;
    /** Default gateway handed out. */
    gateway: IP;
    /** Resolvers handed out. */
    dns?: readonly IP[];
    /** First and last address handed out. */
    pool: readonly [IP, IP];
    /** Seconds a lease lasts. */
    lease_time?: number;
    /** Addresses fixed to a MAC. */
    reservations?: readonly {
        address: IP;
        mac: string;
        /** Whose address it is. */
        description?: string;
    }[];
};

/** Forward DHCP requests heard on an interface to servers elsewhere. */
export type DhcpRelay<I extends string> = {
    /** Where requests are heard. */
    interface: I;
    /** Where they are forwarded. */
    servers: readonly IP[];
};

/** A certificate the device presents or trusts. */
export type Certificate = {
    /** The certificate, PEM. Public, so it lives in the repository. */
    certificate: string;
    /** Its private key: a PEM file through `secretFile`, or PEM base64-encoded as one line through `secret`. A certificate only trusted, such as a CA, has none. */
    private_key?: Secret;
};

/** Export flow records or packet samples to collectors. */
export type FlowExport<I extends string> = {
    /** The record format. */
    protocol: "sflow" | "netflow-v9" | "ipfix";
    /** Where records are sent. */
    collectors: readonly {
        address: IP;
        /** UDP port. 6343 for sFlow and 2055 otherwise when absent. */
        port?: number;
    }[];
    /** Sample one packet in this many. Every packet when absent, on a platform that can export every packet. */
    sampling?: number;
    /** Where traffic is observed. Every interface when absent. */
    interfaces?: readonly I[];
};
