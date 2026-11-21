import type { IP, IPv4, IPv6, MacAddress, Prefix } from "./common";
import type { RadiusServer } from "./system";

/** An address a DHCP server keeps for one client. */
export type Reservation = {
    /** The address it keeps. */
    address: IP;
    /** The client's MAC address. */
    mac: MacAddress;
    /** Whose address it is. On Junos it is documentation only: a static binding there has no place for it. */
    description?: string;
};

/** A DHCP server for one IPv4 network. `F` is the device's VRFs. */
export type DhcpServer<I extends string, F extends string = string> = {
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
    /** RADIUS servers, in order, as `pppoe_server` writes them. A client gets a lease only once they accept it (RFC 2865), asked by its MAC address. They get the accounting of each lease (RFC 2866). Every client gets a lease when absent. */
    radius?: readonly RadiusServer<F>[];
    /** Seconds between reports of each lease's use to the RADIUS servers (RFC 2869). Only at the start and the end of a lease when absent. Only with `radius`. */
    acct_interim_interval?: number;
};

/** Prefixes a DHCPv6 server delegates to routers that ask, such as a customer's router (IA_PD, RFC 9915). */
export type PrefixDelegation = {
    /** The prefix they come from, such as `2001:db8:100:8000::/49`. */
    pool: Prefix;
    /** The length of each prefix delegated, such as 56. */
    prefix_length: number;
};

/** A DHCPv6 server on one interface (RFC 9915). Without `pool` and `prefix_delegation`, it gives hosts only its other settings, such as DNS servers (stateless DHCPv6). */
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

/**
 * A PPPoE server (RFC 2516) for subscribers, such as the homes behind an OLT. The RADIUS servers check each subscriber's name and password (RFC 2865) and get its accounting (RFC 2866). A subscriber's address comes from `pool` unless RADIUS sends one, its IPv6 prefix from `prefix_delegation` unless RADIUS sends one, and its rate from RADIUS. Subscribers live in RADIUS: Circuit writes no local users or rates, and removes those it finds.
 */
export type PppoeServer<I extends string, F extends string = string> = {
    /** The ports and interfaces subscribers connect on. */
    interfaces: readonly I[];
    /** The service name it offers (RFC 2516), such as the network's name. A client that asks for another name gets no answer. Every client is answered when absent. */
    service_name?: string;
    /** The server's own address in every session. */
    local_address: IPv4;
    /** First and last address given to subscribers that RADIUS sends no address for. */
    pool: readonly [IPv4, IPv4];
    /** Resolvers given to subscribers. */
    dns?: readonly IPv4[];
    /** The largest packet a session carries, in bytes. RFC 2516 allows 1492 at most. The platform picks one when absent. */
    mtu?: number;
    /** RADIUS servers, in order: the next one is asked only when one does not answer. */
    radius: readonly RadiusServer<F>[];
    /** Seconds between reports of each session's use to the RADIUS servers (RFC 2869). Only at the start and the end of a session when absent, unless RADIUS sends an interval. */
    acct_interim_interval?: number;
    /** Let the RADIUS servers end a session or change it, such as its rate, on UDP port 3799 (RFC 5176). Off when absent. */
    dynamic_authorization?: true;
    /** IPv6 prefixes delegated to subscribers' routers that ask over their session (DHCPv6 over IPv6CP, RFC 5072), as `dhcpv6_server` delegates them. A subscriber that RADIUS sends a prefix for (Delegated-IPv6-Prefix, RFC 4818) gets that one instead. When absent, only those subscribers get a prefix. */
    prefix_delegation?: PrefixDelegation;
};

/** What the device serves to hosts. `I` is the device's ports and interfaces, `F` its VRFs. */
export type Services<I extends string, F extends string = string> = {
    /** DHCP servers, keyed by name, one per network. */
    dhcp_server?: Record<string, DhcpServer<I, F>>;
    /** DHCPv6 servers, keyed by name, one per interface. */
    dhcpv6_server?: Record<string, Dhcpv6Server<I>>;
    /** DHCP relays, keyed by name. */
    dhcp_relay?: Record<string, DhcpRelay<I>>;
    /** PPPoE servers for subscribers, keyed by name. */
    pppoe_server?: Record<string, PppoeServer<I, F>>;
    /** Answer DNS queries from others, using `system.dns.servers`. Off when absent. */
    dns_server?: true;
    /**
     * DNS64 (RFC 6147): asked for the IPv6 addresses of a name that has IPv4 addresses alone, the DNS server answers with each IPv4 address embedded in `prefix`. A NAT64 translates them (`then: "nat64"`). A name with IPv6 addresses gets those. Needs `dns_server`. Off when absent.
     */
    dns64?: {
        /** The NAT64 prefix it builds addresses in (RFC 6052), such as the well-known `64:ff9b::/96`: the `if.dst` of the NAT64 rule that translates them. */
        prefix: `${IPv6}/${number}`;
    };
    /** Answer time queries from others. Off when absent. Raisecom ROS answers them whenever it takes time from `system.ntp`, and has no setting to stop it, so Circuit writes nothing for it there and warns when it is absent. */
    ntp_server?: true;
    /** Let hosts behind source NAT open their own ports. Off when absent. */
    upnp?: Upnp<I>;
};
