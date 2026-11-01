// What the box serves to hosts: `services.dhcp_server`, `.dhcp_relay`, `.dns_server`, `.ntp_server`.

import type { IP, MacAddress, Prefix } from "./common";

/** An address a DHCP server keeps for one client. */
export type Reservation = {
    /** The address it keeps. */
    address: IP;
    /** The client's MAC address. */
    mac: MacAddress;
    /** Whose address it is. */
    description?: string;
};

/** A DHCP server for one network. */
export type DhcpServer<I extends string> = {
    /** One of the device's ports or interfaces: where it answers. */
    interface: I;
    /** The network it serves. */
    network: Prefix;
    /** Default gateway given to clients. */
    gateway: IP;
    /** Resolvers given to clients. */
    dns?: readonly IP[];
    /** First and last address given to clients. */
    pool: readonly [IP, IP];
    /** Seconds a lease lasts. */
    lease_time?: number;
    /** Addresses fixed to a MAC. */
    reservations?: readonly Reservation[];
};

/** Forward DHCP requests heard on an interface to servers elsewhere. */
export type DhcpRelay<I extends string> = {
    /** One of the device's ports or interfaces: where requests are heard. */
    interface: I;
    /** Where they are forwarded, in order of preference. */
    servers: readonly IP[];
};

/** What the device serves to hosts. `I` is the device's ports and interfaces. */
export type Services<I extends string> = {
    /** DHCP servers, keyed by name, one per network. */
    dhcp_server?: Record<string, DhcpServer<I>>;
    /** DHCP relays, keyed by name. */
    dhcp_relay?: Record<string, DhcpRelay<I>>;
    /** Answer DNS queries from others, from `system.dns.servers`. Off when absent. */
    dns_server?: true;
    /** Answer time queries from others. Off when absent. */
    ntp_server?: true;
};
