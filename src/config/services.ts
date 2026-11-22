import type { HostAddress, IP, IPv4, IPv6, MacAddress, Prefix } from "./common";
import type { IpsecEsp, IpsecIke } from "./interfaces";
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
    /**
     * The relay agent whose clients it serves: the relay's address, which each request it forwards carries (`giaddr`, RFC 2131). The server then answers only that relay's requests, which come in on `interface`, and `network` is the clients' network behind the relay. It serves clients on `interface` itself when absent.
     */
    relay?: IPv4;
};

/** Prefixes a DHCPv6 server delegates to routers that ask, such as a customer's router (IA_PD, RFC 9915). */
export type PrefixDelegation = {
    /** The prefix they come from, such as `2001:db8:100:8000::/49`. */
    pool: Prefix;
    /** The length of each prefix delegated, such as 56. */
    prefix_length: number;
};

/** A DHCPv6 server on one interface (RFC 9915). Without `pool` and `prefix_delegation`, it gives hosts only its other settings, such as DNS servers (stateless DHCPv6). `F` is the device's VRFs. */
export type Dhcpv6Server<I extends string, F extends string = string> = {
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
    /** RADIUS servers, in order, as `dhcp_server` writes them. A client gets an address or a prefix only once they accept it (RFC 2865), asked by the MAC address in its DUID. They get the accounting of each (RFC 2866). A client that RADIUS sends a prefix for (Delegated-IPv6-Prefix, RFC 4818) gets that one in place of one from `prefix_delegation`. Every client gets one when absent. */
    radius?: readonly RadiusServer<F>[];
    /** Seconds between reports of each lease's use to the RADIUS servers (RFC 2869). Only at the start and the end of a lease when absent. Only with `radius`. */
    acct_interim_interval?: number;
};

/** Forward DHCP requests heard on an interface to servers elsewhere. */
export type DhcpRelay<I extends string> = {
    /** The port or interface it hears requests on. */
    interface: I;
    /** Where they are forwarded, in order of preference. */
    servers: readonly IP[];
    /**
     * Add the Relay Agent Information option (Option 82, RFC 3046) to each request it forwards to an IPv4 server. It holds an Agent Circuit ID for the line the request came in on, and an Agent Remote ID, and the platform picks what each holds. A server may then know a client by its line, and RADIUS by RFC 4679's `Agent-Circuit-Id`. Off when absent.
     */
    relay_agent_information?: true;
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

/** The /64s a PPPoE server gives its sessions, one each. */
export type SessionPrefixes = {
    /** The prefix they come from, shorter than a /64, such as `2001:db8:100:1000::/52`. */
    pool: Prefix;
};

/**
 * A PPPoE server (RFC 2516) for subscribers, such as the homes behind an OLT. The RADIUS servers check each subscriber's name and password (RFC 2865) and get its accounting (RFC 2866). A subscriber's address comes from `pool` unless RADIUS sends one, its IPv6 prefix from `prefix_delegation` unless RADIUS sends one, and its rate from RADIUS. Subscribers live in RADIUS: Circuit writes no local users or rates, and removes those it finds.
 */
export type PppoeServer<I extends string, F extends string = string, IS extends string = string> = {
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
    /** A /64 for the subscriber's side of each session, which the server announces in router advertisements, so the subscriber's router makes its own address there (SLAAC, RFC 4862). A subscriber that RADIUS sends one for (Framed-IPv6-Prefix, RFC 3162) gets that one instead. When absent, only those subscribers get one. */
    slaac?: SessionPrefixes;
    /** The interface set, from `firewall.interface_sets`, that each session's interface joins while it is up. A firewall rule with `in_interface_set` or `out_interface_set` then matches every subscriber, though the device names each session's interface only when it comes up. */
    interface_set?: IS;
};

/** Traffic between a prefix on our side and a client's address, both ways: one of the traffic selectors a remote access client gets (RFC 7296 §2.9). */
export type RemoteAccessSelector = {
    /** The prefix on our side: the hosts clients reach. With `0.0.0.0/0`, all of a client's IPv4 traffic goes through the tunnel. */
    local_prefix: `${IPv4}/${number}`;
};

/** How users prove who they are: with EAP, which RADIUS servers check, or with a certificate. Write one of the two. */
export type RemoteAccessUsers<F extends string, C extends string> =
    | {
          /**
           * RADIUS servers, in order: the next one is asked only when one does not answer. The device passes each user's EAP messages to them (RFC 3579). So they check the user by the EAP method they choose, such as EAP-MSCHAPv2 or EAP-TLS (RFC 7296 §2.16). They get the accounting of each session (RFC 2866).
           */
          radius: readonly RadiusServer<F>[];
          ca_certificate?: never;
      }
    | {
          /** The CA that signs users' certificates, one of `system.certificates`, without its private key. The device takes any certificate this CA signed, so give the CA a `crl_url`, and revoke a user's certificate there. */
          ca_certificate: C;
          radius?: never;
      };

/**
 * IPsec remote access (RFC 7296 §1.1.3 and §2.19): laptops and phones that connect from anywhere, rather than one fixed peer. Each client starts IKEv2 to `local_address`, and asks for an address in a configuration payload (RFC 7296 §3.15). The device gives it an address from `pool` and the DNS servers in `dns`. ESP then carries the traffic between that address and `traffic_selectors`. The device proves who it is with `certificate`, and users prove who they are with EAP through `radius`, or with a certificate `ca_certificate` signed.
 */
export type IpsecRemoteAccess<F extends string = string, C extends string = string> = {
    /** Shown beside it on the device. */
    description?: string;
    /** Our address the clients connect to, alone or with its length. */
    local_address: HostAddress;
    /** First and last address given to clients, one to each (INTERNAL_IP4_ADDRESS, RFC 7296 §3.15.1). */
    pool: readonly [IPv4, IPv4];
    /** DNS servers given to clients (INTERNAL_IP4_DNS, RFC 7296 §3.15.1). None when absent. */
    dns?: readonly IPv4[];
    /** The traffic a client may send through the tunnel: between its address and each `local_prefix`. A client that asks for more, such as all its traffic, gets these alone (RFC 7296 §2.9). */
    traffic_selectors: readonly RemoteAccessSelector[];
    ike: IpsecIke;
    esp: IpsecEsp;
    /**
     * The device's certificate, one of `system.certificates` with its private key. The device signs with it, and clients check it against the CA that signed it, and against the name they connect to. RFC 7296 §2.16 has the device sign so even when users use EAP.
     */
    certificate: C;
} & RemoteAccessUsers<F, C>;

/** What the device serves to hosts. `I` is the device's ports and interfaces, `F` its VRFs, `IS` its interface sets, `C` its certificates. */
export type Services<I extends string, F extends string = string, IS extends string = string, C extends string = string> = {
    /** DHCP servers, keyed by name, one per network. */
    dhcp_server?: Record<string, DhcpServer<I, F>>;
    /** DHCPv6 servers, keyed by name, one per interface. */
    dhcpv6_server?: Record<string, Dhcpv6Server<I, F>>;
    /** DHCP relays, keyed by name. */
    dhcp_relay?: Record<string, DhcpRelay<I>>;
    /** PPPoE servers for subscribers, keyed by name. */
    pppoe_server?: Record<string, PppoeServer<I, F, IS>>;
    /** IPsec remote access for laptops and phones, keyed by name. */
    ipsec_remote_access?: Record<string, IpsecRemoteAccess<F, C>>;
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
