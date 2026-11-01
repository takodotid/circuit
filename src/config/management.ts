// How people and tools log in: `management.ssh`, `.https`, `.api`, `.native_protocol`, `.console`, and the rest. SNMP polling is `monitoring.snmp`.

import type { Prefix, Secret } from "./common";

/** A way into the device. Absent means turned off. */
export type Service = {
    /** Sources allowed. `management.allow` when absent. */
    allow?: readonly Prefix[];
    /** TCP or UDP port. The protocol's own when absent. */
    port?: number;
};

/** How the device is reached and managed. `I` is the device's ports and interfaces, `C` its certificates, `AS` its address sets. */
export type Management<I extends string, C extends string, AS extends string = string> = {
    /**
     * Sources allowed to every service that does not set its own: a list, or one of `firewall.address_sets` by name, so a device that
     * filters on those sources too writes them once. Circuit writes the set's addresses here.
     */
    allow?: readonly Prefix[] | AS;
    /** Some of the device's ports and interfaces: the ones the services answer on; every other one answers ping alone. Every one with an address when absent. */
    interfaces?: readonly I[];
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
        /** One of `system.certificates`. */
        certificate?: C;
    };
    /** The platform's own API, unencrypted. */
    api?: Service;
    /** The platform's own API over TLS. */
    api_tls?: Service & {
        /** One of `system.certificates`. */
        certificate?: C;
    };
    /** File transfer, unencrypted. */
    ftp?: Service;
    /** The platform's own management protocol, such as Winbox. `interfaces` also allows it at layer 2 on those interfaces. */
    native_protocol?: Service & {
        /** Some of the device's ports and interfaces. */
        interfaces?: readonly I[];
    };
    /** Console login uses this password. The device's users when absent. */
    console?: {
        /** The console password. */
        password: Secret;
    };
    /** Password for privileged mode, on platforms that have one. */
    privilege_password?: Secret;
};
