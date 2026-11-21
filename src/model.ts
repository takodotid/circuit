// A device as its project wrote it, after `src/project.ts` turned the language's shorthands into plain values. Each name is plain text here, as the project's types already checked it. The fields and their docs are those of `src/config/`.

import type * as C from "./config/index";

export type {
    AdvertisedPrefix,
    AsNumbers,
    AsRange,
    BgpFamily,
    BoundHost,
    Certificate,
    Dscp,
    Ethertype,
    Exchange,
    Family,
    Helper,
    IP,
    IPv4,
    IPv6,
    IpsecEncryption,
    IpsecEsp,
    IpsecIke,
    IpsecIntegrity,
    Limit,
    Link,
    MacAddress,
    PortRange,
    Ports,
    Prefix,
    PrefixDelegation,
    Protocol,
    Rate,
} from "./config/index";
export type {
    Secret,
    Severity,
    SnmpTrapTarget,
    SnmpUser,
    Stp,
    Threshold,
    Vrrp,
    WireGuardPeer,
    Bfd,
    RpkiServer,
    OspfAuthentication,
    OspfInterface,
    PrefixSet,
    RadiusServer,
    RateLimit,
    RouterAdvertisement,
    RouteSet,
    User,
    Vlan,
} from "./config/index";

export type Device = C.AnyDevice;

/** A physical port, in `interfaces.ethernet`. */
export type Port = C.AnyPort;

export type Lag = C.Lag<string, string>;
export type VlanInterface = C.VlanInterface<string, string>;
export type Loopback = C.Loopback<string>;
export type Gre = C.Gre<string>;
export type Vxlan = C.Vxlan<string>;
/** The settings of other interfaces an IPsec tunnel has none of are never there, so code reads them from any interface alike. */
export type Ipsec = C.Ipsec & Partial<Record<Exclude<keyof C.Base<string>, keyof C.Ipsec>, never>>;
export type WireGuard = C.WireGuard<string, string>;
export type Eoip = C.Eoip<string, string>;
export type Bridge = C.Bridge<string, string>;
/** The settings of ports and other interfaces a pseudowire has none of are never there, so code reads them from any port or interface alike. */
export type Pseudowire = C.Pseudowire<string> &
    Partial<Record<Exclude<keyof C.Base<string> | keyof C.Switched<string>, keyof C.Pseudowire<string>>, never>>;

/** The settings of other interfaces a PPPoE client has none of are never there, so code reads them from any interface alike. */
export type PppoeClient = C.PppoeClient<string, string> &
    Partial<Record<Exclude<keyof C.Base<string>, keyof C.PppoeClient<string, string>>, never>>;

/** Any interface that is not a port: what `interfaces` holds besides `ethernet`. */
export type Interface = Lag | VlanInterface | Loopback | Gre | Vxlan | Ipsec | WireGuard | Bridge | Eoip | Pseudowire | PppoeClient;

/** The kinds of interface `interfaces` groups by, besides `ethernet`. */
export type InterfaceKind =
    "lag" | "vlan_interface" | "loopback" | "gre" | "vxlan" | "ipsec" | "wireguard" | "bridge" | "eoip" | "pseudowire" | "pppoe_client";

export type Switched = C.Switched<string>;
export type Routed = C.Routed<string>;
export type Address = C.Address;

export type FilterMatch = C.FilterMatch<string, string, string>;
export type FilterRule = C.FilterRule<string, string, string>;
export type NatRule = C.NatRule<string, string, string>;
/** A source translation to a pool, with blocks of ports for each subscriber. */
export type PoolNatRule = Extract<NatRule, { to_pool: unknown }>;
/** A pool whose blocks follow from each subscriber's address (RFC 7422). */
export type DeterministicPoolNatRule = Extract<PoolNatRule, { port_allocation: "deterministic" }>;
/** A pool that hands out blocks of ports as subscribers need them, and logs each. */
export type DynamicPoolNatRule = Extract<PoolNatRule, { port_allocation: "dynamic" }>;
export type TcpMssRule = C.TcpMssRule<string, string, string>;
export type MarkingRule = C.MarkingRule<string, string, string>;
export type Scheduler = C.Scheduler<string>;
export type Queue = C.Queue<string>;
export type AclRule = C.AclRule<string>;
export type PolicyRule = C.PolicyRule<string, string>;
export type RouteRule = C.RouteRule<string>;
export type RouteMatch = C.RouteMatch<string>;
export type CallRule = C.CallRule<string>;
export type RoutingRule = C.RoutingRule<string, string>;
export type StaticRoute = C.StaticRoute<string, string, string>;
export type NeighborSettings = C.NeighborSettings<string, string>;
export type Neighbor = C.Neighbor<string, string, string>;
export type Service = C.Service;
export type Console = C.Console;
export type Jump = C.Jump;
export type DhcpServer = C.DhcpServer<string, string>;
export type Dhcpv6Server = C.Dhcpv6Server<string, string>;
export type DhcpRelay = C.DhcpRelay<string>;
export type PppoeServer = C.PppoeServer<string, string>;
export type FlowExport = C.FlowExport<string>;
export type SyslogServer = C.SyslogServer;
export type Probe = C.Probe;
export type Ospf = C.Ospf<string>;
export type OspfArea = C.OspfArea<string>;
export type Isis = C.Isis<string>;
export type Mpls = C.Mpls<string>;

/** Something wrong with a config, as `circuit validate` reports it. */
export type Finding = {
    /** An error stops `diff` and `apply`. A warning is only reported. */
    level: "error" | "warning";
    /** The device it is about, when it is about one. */
    device?: string;
    /** What is wrong, in a sentence. */
    message: string;
};
