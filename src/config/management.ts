// SNMP polling is in `monitoring.snmp`, not here.

import type { Prefix, Secret } from "./common";

/** A way into the device. Leave it out to turn it off. */
export type Service = {
    /** The sources allowed to use it. `management.allow` when absent. */
    allow?: readonly Prefix[];
    /** The TCP or UDP port. The protocol's standard port when absent. */
    port?: number;
};

/** How the device is reached and managed. `I` is the device's ports and interfaces, `C` its certificates, `AS` its address sets. */
export type Management<I extends string, C extends string, AS extends string = string> = {
    /**
     * The sources allowed to every service that doesn't set its own `allow`. Write a list, or the name of one of `firewall.address_sets`, so a device that also filters on those sources writes them once.
     */
    allow?: readonly Prefix[] | AS;
    /** The ports and interfaces the services answer on. Every other one answers only ping. Every port and interface with an address when absent. */
    interfaces?: readonly I[];
    /** Secure shell (SSH). */
    ssh?: Service & {
        /** Also offer legacy ciphers, MACs, and key exchanges. Off when absent. */
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
    /** The platform's own management protocol, such as Winbox. With `interfaces`, it also works at layer 2 on those interfaces. */
    native_protocol?: Service & {
        /** The ports and interfaces where it also works at layer 2. */
        interfaces?: readonly I[];
    };
    /** A password for console login. When absent, the device's users log in on the console. */
    console?: {
        /** The console password. */
        password: Secret;
    };
    /** Password for privileged mode, on platforms that have one. */
    privilege_password?: Secret;
};
