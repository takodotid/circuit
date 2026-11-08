// Every port and interface, by kind: `interfaces.ethernet`, `.lag`, `.vlan_interface`, `.bridge`, `.loopback`, `.gre`, `.vxlan`, `.wireguard`, `.eoip`.

import type { HostAddress, IP, InterfaceAddress, MacAddress, Named, Prefix, Secret } from "./common";

/** A storm-control threshold: packets per second, or percent of the link's speed. */
export type Threshold =
    | {
          /** Packets per second. */
          pps: number;
      }
    | {
          /** Percent of the link's speed, above 0 and up to 100. */
          percent: number;
      };

/** A kind of frame, by the ethertype in its header: `ipv4` is 0x0800, `ipv6` 0x86DD, `arp` 0x0806. */
export type Ethertype = "ipv4" | "ipv6" | "arp";

/** A virtual router address shared with other devices on the same segment, RFC 9568 (VRRPv3). */
export type Vrrp = {
    /** Virtual router number, 1 to 255. The same on every device sharing the address. */
    id: number;
    /** The shared address, without a length. */
    address: IP;
    /** Higher wins the master election, 1 to 254. 100 when absent. */
    priority?: number;
    /** Take mastership back from a lower priority device when this one returns. Off when absent. */
    preempt?: boolean;
    /** Seconds between advertisements. 1 when absent. */
    interval?: number;
};

/** Presence at an internet exchange, as a registry lists it. The addresses are the interface's own. */
export type Exchange = {
    /** The exchange's name, for output. */
    name: string;
    /** Capacity toward the exchange, in Mbit/s. */
    speed: number;
    /** The exchange LAN's id at PeeringDB, its `ixlan_id`. */
    peeringdb_ixlan?: number;
};

/** An address with its length, or `{ address, peer_address }` for a point-to-point address whose far end is outside its own prefix. */
export type Address =
    | InterfaceAddress
    | {
          /** Our address, with its length. */
          address: InterfaceAddress;
          /** The far end's address. */
          peer_address: IP;
      };

/** Layer 3 settings shared by every interface that can have an address. `Vrf` is the device's VRF names. */
export type Routed<Vrf extends string> = {
    /** Addresses with their length. Use `{ address, peer_address }` for a point-to-point address whose far end is outside its own prefix. */
    addresses?: readonly Address[];
    /** Send IPv6 router advertisements on this interface. Off when absent. */
    ipv6_ra?: boolean;
    /** Overrides `system.hardware_offload` for traffic routed through this interface. Software forwarding is what makes the firewall apply. */
    hardware_offload?: boolean;
    /** Virtual router addresses on this interface. */
    vrrp?: readonly Vrrp[];
    /** One of `routing.vrfs`: the VRF this interface routes in. The main table when absent. */
    vrf?: Vrf;
    /** This interface is the network's presence at an internet exchange. Devices ignore it; `circuit peeringdb` publishes it. */
    exchange?: Exchange;
};

/** Spanning tree settings for one port. */
export type PortStp = {
    /** The port faces a host, never a switch, so it forwards at once. */
    edge?: boolean;
    /** Path cost. Lower is preferred. Derived from speed when absent. */
    cost?: number;
    /** Port priority, 0 to 240 in steps of 16. Lower is preferred. */
    priority?: number;
};

/** Drop flooded traffic above these thresholds. */
export type StormControl = {
    /** Frames to every host. */
    broadcast?: Threshold;
    /** Frames to a group. */
    multicast?: Threshold;
    /** Frames to a MAC address the switch has not learned. */
    unknown_unicast?: Threshold;
};

/** Layer 2 membership. A port or LAG with none of these is routed. `Vlan` is the device's VLAN names. */
export type Switched<Vlan extends string> = {
    /** One of `switching.vlans`: the one VLAN this port or LAG is in, untagged. */
    access_vlan?: Vlan;
    /** Some of `switching.vlans`: the VLANs this port or LAG carries, tagged. */
    trunk_vlans?: readonly Vlan[];
    /** One of `switching.vlans`: untagged frames on a trunk are in this VLAN. Only with `trunk_vlans`. */
    native_vlan?: Vlan;
    /** Overrides `switching.stp` for this port. `false` stops it sending or acting on BPDUs. */
    stp?: boolean | PortStp;
    /** Drop flooded traffic above these thresholds. */
    storm_control?: StormControl;
    /** The most MAC addresses this port or LAG learns, 1 or more. Frames from any other source address are dropped. An exchange sets 1 on a member port, so each member sends from one router only. No limit when absent. */
    mac_limit?: number;
    /** The only kinds of frame this port or LAG takes in; any other kind is dropped. An exchange takes `ipv4`, `ipv6` and `arp` on a member port. Every kind when absent. */
    ethertypes?: readonly Ethertype[];
};

/**
 * The other end of a cable: another of our devices and its port. Both ends must agree on how they are switched, and the far end must
 * link back. The port's own `description` names that end, `<far device> <far port as printed there>`, such as `fw-01 port6`:
 * Circuit warns when it doesn't, and never writes it.
 */
export type Link = {
    /** The device at the other end, by its key in `devices`. */
    device: string;
    /** The port on that device, such as `10g-2`. */
    port: string;
    /**
     * What is between the two ends when the cable is not direct, such as a carrier's local loop or L2 transport: `"Carrier A local loop"`. LLDP then sees the carrier's switches, not the far end, so `validate` does not compare LLDP on this port. Both ends name the same carrier.
     */
    through?: string;
};

/** Where a DHCP client puts the default route its server gives: one table, at one distance. */
export type DhcpDefaultRoute<Table extends string> = {
    /** One of `routing.tables`, or `main`. `main` when absent. */
    routing_table?: Table | "main";
    /** Preference among routes to the same prefix, lower wins. 1 when absent. */
    distance?: number;
};

/** An IPv4 address taken from a DHCP server on the link, such as an ISP's modem. The server's DNS and time servers are not used: `system.dns` and `system.ntp` are. */
export type DhcpClient<Table extends string> = {
    /** Where the default route the server gives goes, each table at its distance. The main table at distance 1 when absent; an empty list puts it nowhere. */
    default_routes?: readonly DhcpDefaultRoute<Table>[];
};

/** A physical port, by its key `<speed>-<position>`, such as `10g-4`. Ports a device does not declare are shut down. */
export type Port<
    Vlan extends string,
    Acl extends string,
    Lag extends string,
    Vrf extends string,
    Table extends string = string,
> = Routed<Vrf> &
    Switched<Vlan> & {
        /** What is plugged in. On a port with a `link`, the far end: `<far device> <far port as printed there>`. */
        description?: string;
        /** Largest IP packet, in bytes. 1500 when absent. */
        mtu?: number;
        /** Fixed speed, for an optic slower than the cage. Negotiated when absent. */
        speed?: "100m" | "1g" | "10g" | "25g" | "40g" | "50g" | "100g";
        /** Overrides `switching.lldp` for this port. */
        lldp?: boolean;
        /** One of `switching.acls`: the hardware ACL applied to traffic arriving on this port. */
        ingress_acl?: Acl;
        /** One of `interfaces.lag`: the LAG this port is in. Every other setting goes on the LAG. */
        in_lag?: Lag;
        /** Another of our devices at the other end of the cable. Circuit checks that it links back, and warns when `description` doesn't name it. */
        link?: Link;
        /** Take an IPv4 address from a DHCP server on the link, besides any in `addresses`. None when absent. */
        dhcp_client?: DhcpClient<Table>;
        /** Traffic leaving through it is held to a rate by a queue. Not shaped when absent. */
        shaping?: Shaping;
    };

/**
 * Traffic leaving through an interface, held to a rate by a queue. CAKE (RFC 8290's FQ-CoDel with its own shaper) keeps latency low under load when the rate is a little below the slowest link on the way.
 */
export type Shaping = {
    /** The queue: `cake`. */
    algorithm: "cake";
    /** The most traffic leaves, in Mbit/s. */
    mbps: number;
};

/** Settings every interface that is not a physical port shares. */
export type Base<Vrf extends string> = Routed<Vrf> & {
    /** What the interface is for. */
    description?: string;
    /** Largest IP packet, in bytes. */
    mtu?: number;
    /** Traffic leaving through it is held to a rate by a queue. Not shaped when absent. */
    shaping?: Shaping;
};

/** A layer 3 interface on a VLAN. */
export type VlanInterface<Vlan extends string, Vrf extends string> = Base<Vrf> & {
    /** One of `switching.vlans`: the VLAN it is on. */
    vlan: Vlan;
    /**
     * A MAC address of its own, instead of the one it shares with the device's other VLAN interfaces. A gateway in front of a transparent firewall needs one: frames to it come back on another VLAN, where the bridge would otherwise take a shared MAC for its own and keep them.
     */
    mac?: MacAddress;
    /**
     * Addresses of its subnet that live elsewhere, which it answers ARP for with its own MAC and then routes: an address taken out of the subnet and routed to another link, which the hosts on the subnet still take for a neighbor. None when absent.
     */
    proxy_arp?: readonly IP[];
};

/** An interface that is always up and is on no link, for addresses that must not depend on one. */
export type Loopback<Vrf extends string> = Base<Vrf>;

/**
 * How a LAG finds a member that no longer carries traffic: an ARP request to each target over every member, every `interval_ms`. A member that gets no reply leaves the LAG until it gets one again. For members whose own link stays up when the path behind it fails, such as tunnels.
 */
export type LinkCheck = {
    /** The addresses asked, on the LAG's own subnet: the far end's address on the LAG. */
    arp_targets: readonly IP[];
    /** Milliseconds between requests. */
    interval_ms: number;
};

/** A link aggregation. Each member port or EoIP tunnel points to it with `in_lag`. */
export type Lag<Vlan extends string, Vrf extends string> = Base<Vrf> &
    Switched<Vlan> & {
        /**
         * LACP negotiates membership with the far end; `static` joins the ports without asking; `round_robin` sends each packet over the next member in turn, so one flow uses every member (Linux's balance-rr), and takes no part in LACP. LACP when absent.
         */
        mode?: "lacp" | "static" | "round_robin";
        /** Number, on platforms where a LAG has a number instead of a name. Its position among the device's LAGs when absent. */
        id?: number;
        /** Find a member that no longer carries traffic by ARP, and take it out. Each member's link state only when absent. */
        link_check?: LinkCheck;
        /** A fixed MAC address. A LAG of tunnels otherwise takes a member's, which a tunnel may make up anew each time the device starts, while the far end keeps the old one in its ARP table. A member's when absent. */
        mac?: MacAddress;
    };

/** A GRE tunnel. */
export type Gre<Vrf extends string> = Base<Vrf> & {
    /** Our tunnel endpoint, alone or with its length. */
    local_address: HostAddress;
    /** The far tunnel endpoint. */
    remote_address: IP;
};

/** A point-to-point VXLAN tunnel. */
export type Vxlan<Vrf extends string> = Base<Vrf> & {
    /** Segment identifier, the same on both ends, 1 to 16777215. */
    vni: number;
    /** Our tunnel endpoint, alone or with its length. */
    local_address: HostAddress;
    /** The far tunnel endpoint. */
    remote_address: IP;
    /** UDP port. 4789 when absent. */
    port?: number;
    /** Fixed MAC address, so a rebuild keeps the one the far side learned. */
    mac?: MacAddress;
};

/**
 * An Ethernet tunnel over IP (EoIP, MikroTik's GRE carrying Ethernet frames, IP protocol 47): it carries layer 2 between two routers, so it can be a member of a LAG. Both ends write the same `tunnel_id`.
 */
export type Eoip<Lag extends string, Vrf extends string> = Base<Vrf> & {
    /** Our tunnel endpoint, alone or with its length. */
    local_address: HostAddress;
    /** The far tunnel endpoint. */
    remote_address: IP;
    /** The tunnel's number, 0 to 65535, the same on both ends and unique among the device's EoIP tunnels. */
    tunnel_id: number;
    /** One of `interfaces.lag`: the LAG this tunnel is a member of. */
    in_lag?: Lag;
};

/** A host and a UDP port, `host:port`, for example `203.0.113.10:51820` or `vpn.example.net:51820`. */
export type Endpoint = `${string}:${number}`;

/** One peer of a WireGuard interface. */
export type WireGuardPeer = {
    /** Who or what the peer is. */
    name: string;
    /** The peer's public key. Public keys are not secrets. */
    public_key: string;
    /** Addresses the peer may send from and that are routed to it. */
    allowed_addresses: readonly Prefix[];
    /** `host:port`, for a peer this side dials. The peer dials in when absent. */
    endpoint?: Endpoint;
    /** Seconds between keepalives, for a peer behind NAT. None when absent. */
    keepalive?: number;
    /** What a generated client config routes into the tunnel. Affects no forwarding here. */
    client_allowed_addresses?: readonly Prefix[];
};

/** A WireGuard interface. */
export type WireGuard<Vrf extends string, Table extends string = string> = Base<Vrf> & {
    /** UDP port peers connect to. */
    listen_port: number;
    /** One of `routing.tables`: the table the tunnel's own packets to its peers are routed by, such as one that leaves through one uplink only, so the tunnel never moves to another. The main table when absent. */
    routing_table?: Table;
    /** The address clients connect to, for generated client configs, alone or with its length. */
    endpoint?: HostAddress;
    /** This interface's private key. Its public key is derived from it. */
    private_key: Secret;
    /** Who may connect. */
    peers?: readonly WireGuardPeer[];
};

/**
 * A layer 2 bridge between VLAN interfaces, each keeping its own VLAN: a frame that comes in on one member leaves another with that member's tag. A firewall filters what crosses it, by the rules of its forward chain between the members, without routing it.
 */
export type Bridge<VlanInterface extends string, Vrf extends string> = Base<Vrf> & {
    /** Some of `interfaces.vlan_interface`: the VLAN interfaces it joins. Each has no address of its own. */
    member_interfaces: readonly VlanInterface[];
};

/**
 * Every port and interface, by kind, each keyed by its name. A port's key is `<speed>-<position>` from the model.
 *
 * The type parameters are the names the device declares: `Ethernet` the ports, `L` LAGs, `VI` VLAN interfaces, `T` the other interfaces, `V` VLANs, `F` VRFs, `Table` routing tables.
 */
export type Interfaces<
    Ethernet,
    L extends string,
    VI extends string,
    T extends string,
    V extends string,
    F extends string,
    Table extends string = string,
> = {
    /** Physical ports, keyed by `<speed>-<position>` from the model, such as `10g-4`. Ports not listed are shut down. */
    ethernet?: Ethernet;
    /** Link aggregations, keyed by name. Each member port names one with `in_lag`. */
    lag?: Named<L, Lag<V, F>>;
    /** Layer 3 interfaces on a VLAN, keyed by name. Each names its VLAN in `vlan`. */
    vlan_interface?: Named<VI, VlanInterface<V, F>>;
    /** Layer 2 bridges between VLAN interfaces, keyed by name. */
    bridge?: Named<T, Bridge<NoInfer<VI>, F>>;
    /** Interfaces on no link, keyed by name. */
    loopback?: Named<T, Loopback<F>>;
    /** GRE tunnels, keyed by name. */
    gre?: Named<T, Gre<F>>;
    /** Point-to-point VXLAN tunnels, keyed by name. */
    vxlan?: Named<T, Vxlan<F>>;
    /** WireGuard interfaces, keyed by name. */
    wireguard?: Named<T, WireGuard<F, Table>>;
    /** Ethernet tunnels over IP, keyed by name. Each may be a member of a LAG with `in_lag`. */
    eoip?: Named<T, Eoip<NoInfer<L>, F>>;
};
