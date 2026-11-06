// The model as Circuit's own code reads it: a device as its project wrote it, after `src/project/project.ts` turned what the language adds into
// plain values (a list in a match is one rule per value, an interface set its interfaces, `management.allow` its addresses). Each name is plain text
// here: the project's types already checked it. The fields and their docs are those of `src/config/`, which a project writes.

import type * as C from "./config/index";

export type {
    Certificate,
    Ethertype,
    Exchange,
    Family,
    Helper,
    IP,
    IPv4,
    IPv6,
    Link,
    MacAddress,
    PortRange,
    Ports,
    Prefix,
    Protocol,
    Rate,
} from "./config/index";
export type {
    Secret,
    Severity,
    SnmpUser,
    Stp,
    Threshold,
    Vrrp,
    WireGuardPeer,
    Bfd,
    RpkiServer,
    OspfInterface,
    PrefixSet,
    RouteSet,
    User,
    Vlan,
} from "./config/index";

/** A device: name, site, platform, model, connection and its groups. */
export type Device = C.AnyDevice;

/** A physical port, in `interfaces.ethernet`. */
export type Port = C.AnyPort;

export type Lag = C.Lag<string, string>;
export type VlanInterface = C.VlanInterface<string, string>;
export type Loopback = C.Loopback<string>;
export type Gre = C.Gre<string>;
export type Vxlan = C.Vxlan<string>;
export type WireGuard = C.WireGuard<string>;
export type Eoip = C.Eoip<string, string>;
export type Bridge = C.Bridge<string, string>;

/** Any interface that is not a port: what `interfaces` holds besides `ethernet`. */
export type Interface = Lag | VlanInterface | Loopback | Gre | Vxlan | WireGuard | Bridge | Eoip;

/** The kinds of interface `interfaces` groups by, besides `ethernet`. */
export type InterfaceKind = "lag" | "vlan_interface" | "loopback" | "gre" | "vxlan" | "wireguard" | "bridge" | "eoip";

export type Switched = C.Switched<string>;
export type Routed = C.Routed<string>;
export type Address = C.Address;

export type FilterMatch = C.FilterMatch<string, string, string>;
export type FilterRule = C.FilterRule<string, string, string>;
export type NatRule = C.NatRule<string, string, string>;
export type TcpMssRule = C.TcpMssRule<string, string, string>;
export type AclRule = C.AclRule<string>;
export type PolicyRule = C.PolicyRule<string, string>;
export type RouteRule = C.RouteRule<string>;
export type CallRule = C.CallRule<string>;
export type RoutingRule = C.RoutingRule<string, string>;
export type StaticRoute = C.StaticRoute<string, string, string>;
export type NeighborSettings = C.NeighborSettings<string, string>;
export type Neighbor = C.Neighbor<string, string, string>;
export type Service = C.Service;
export type Console = C.Console;
export type Jump = C.Jump;
export type DhcpServer = C.DhcpServer<string>;
export type DhcpRelay = C.DhcpRelay<string>;
export type FlowExport = C.FlowExport<string>;
export type SyslogServer = C.SyslogServer;
export type Ospf = C.Ospf<string>;
