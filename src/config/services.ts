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
    /** The port or interface it answers on. */
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
    /** The port or interface it hears requests on. */
    interface: I;
    /** Where they are forwarded, in order of preference. */
    servers: readonly IP[];
};

/** UPnP for hosts behind the device's source NAT, such as game consoles. A host can open its own ports to the outside, through the device. */
export type Upnp<I extends string> = {
    /** The ports and interfaces where hosts ask. */
    internal: readonly I[];
    /** The port or interface the opened ports are reached from. */
    external: I;
    /** The outside address hosts are told is theirs, if it is not the address of `external`. For example, the address source NAT gives all traffic that leaves through it. The address of `external` when absent. */
    external_address?: IP;
};

/** What the device serves to hosts. `I` is the device's ports and interfaces. */
export type Services<I extends string> = {
    /** DHCP servers, keyed by name, one per network. */
    dhcp_server?: Record<string, DhcpServer<I>>;
    /** DHCP relays, keyed by name. */
    dhcp_relay?: Record<string, DhcpRelay<I>>;
    /** Answer DNS queries from others, using `system.dns.servers`. Off when absent. */
    dns_server?: true;
    /** Answer time queries from others. Off when absent. */
    ntp_server?: true;
    /** Let hosts behind source NAT open their own ports. Off when absent. */
    upnp?: Upnp<I>;
};
