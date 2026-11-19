import type { IP, IPv6, MacAddress, Prefix } from "./common";

/** An address a DHCP server keeps for one client. */
export type Reservation = {
    /** The address it keeps. */
    address: IP;
    /** The client's MAC address. */
    mac: MacAddress;
    /** Whose address it is. On Junos it is documentation only: a static binding there has no place for it. */
    description?: string;
};

/** A DHCP server for one IPv4 network. */
export type DhcpServer<I extends string> = {
    /** The port or interface it answers on. */
    interface: I;
    /** The IPv4 network it serves. An IPv6 network is served by `dhcpv6_server`. */
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

/** Prefixes a DHCPv6 server delegates to routers that ask, such as a customer's router (IA_PD, RFC 8415). */
export type PrefixDelegation = {
    /** The prefix they come from, such as `2001:db8:100:8000::/49`. */
    pool: Prefix;
    /** The length of each prefix delegated, such as 56. */
    prefix_length: number;
};

/** A DHCPv6 server on one interface (RFC 8415). Without `pool` and `prefix_delegation`, it gives hosts only its other settings, such as DNS servers (stateless DHCPv6). */
export type Dhcpv6Server<I extends string> = {
    /** The port or interface it answers on. */
    interface: I;
    /** First and last address given to hosts (IA_NA), in an IPv6 network of `interface`. Hosts ask for one when `ipv6_ra` has `managed: true`. */
    pool?: readonly [IPv6, IPv6];
    /** Prefixes delegated to routers that ask. */
    prefix_delegation?: PrefixDelegation;
    /** DNS servers given to hosts. Hosts that make their own addresses ask for them when `ipv6_ra` has `other_config: true`. */
    dns?: readonly IPv6[];
    /** Seconds an address or prefix lasts. */
    lease_time?: number;
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
    /** DHCPv6 servers, keyed by name, one per interface. */
    dhcpv6_server?: Record<string, Dhcpv6Server<I>>;
    /** DHCP relays, keyed by name. */
    dhcp_relay?: Record<string, DhcpRelay<I>>;
    /** Answer DNS queries from others, using `system.dns.servers`. Off when absent. */
    dns_server?: true;
    /** Answer time queries from others. Off when absent. */
    ntp_server?: true;
    /** Let hosts behind source NAT open their own ports. Off when absent. */
    upnp?: Upnp<I>;
};
