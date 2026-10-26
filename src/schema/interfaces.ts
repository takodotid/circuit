import type { InterfaceAddress, IP, MacAddress, Prefix, Secret } from "./common";

/** A VLAN. Its key in `vlans` is its name. */
export type Vlan = {
    /** The VLAN's number on the wire, 1 to 4094. */
    id: number;
    /** What the VLAN is for. */
    description?: string;
};

/** A storm-control threshold: packets per second, or percent of the link's speed. */
export type Threshold = { pps: number } | { percent: number };

/** A kind of frame, by the ethertype in its header: `ipv4` is 0x0800, `ipv6` 0x86DD, `arp` 0x0806. */
export type Ethertype = "ipv4" | "ipv6" | "arp";

/** A virtual router address shared with other devices on the same segment, RFC 5798. */
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

/** Layer 3 settings shared by every interface that can have an address. */
export type Routed<F extends string> = {
    /** Addresses with their length. Use `{ address, peer }` for a point-to-point address whose far end is outside its own prefix. */
    addresses?: readonly (InterfaceAddress | { address: InterfaceAddress; peer: IP })[];
    /** Send IPv6 router advertisements on this interface. Off when absent. */
    ipv6_ra?: boolean;
    /** Overrides the device's `hardware_offload` for traffic routed through this interface. Software forwarding is what makes the firewall apply. */
    hardware_offload?: boolean;
    /** Virtual router addresses on this interface. */
    vrrp?: readonly Vrrp[];
    /** The VRF this interface routes in. The default table when absent. */
    vrf?: F;
    /** This interface is the network's presence at an internet exchange. Devices ignore it; `circuit peeringdb` publishes it. */
    exchange?: Exchange;
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

/** Spanning tree settings for one port. */
export type PortStp = {
    /** The port faces a host, never a switch, so it forwards at once. */
    edge?: boolean;
    /** Path cost. Lower is preferred. Derived from speed when absent. */
    cost?: number;
    /** Port priority, 0 to 240 in steps of 16. Lower is preferred. */
    priority?: number;
};

/** Layer 2 membership. A port or LAG with none of these is routed. */
export type Switched<V extends string> = {
    /** The one VLAN this port or LAG is in, untagged. */
    access_vlan?: V;
    /** The VLANs this port or LAG carries, tagged. */
    trunk_vlans?: readonly V[];
    /** Untagged frames on a trunk are in this VLAN. Only with `trunk_vlans`. */
    native_vlan?: V;
    /** Overrides the device's `stp` for this port. `false` stops it sending or acting on BPDUs. */
    stp?: boolean | PortStp;
    /** Drop flooded traffic above these thresholds. */
    storm_control?: {
        broadcast?: Threshold;
        multicast?: Threshold;
        unknown_unicast?: Threshold;
    };
    /** The most MAC addresses this port or LAG learns, 1 or more. Frames from any other source address are dropped. An exchange sets 1 on a member port, so each member sends from one router only. No limit when absent. */
    mac_limit?: number;
    /** The only kinds of frame this port or LAG takes in; any other kind is dropped. An exchange takes `ipv4`, `ipv6` and `arp` on a member port. Every kind when absent. */
    ethertypes?: readonly Ethertype[];
};

/** The other end of a cable: another device and its port. Both ends must agree on how they are switched. */
export type Link = {
    /** Name of the device at the other end. */
    device: string;
    /** The port on that device. */
    port: string;
    /**
     * What is between the two ends when the cable is not direct, such as a carrier's local loop or L2 transport: `"Carrier A local loop"`. LLDP then sees the carrier's switches, not the far end, so `validate` does not compare LLDP on this port. Both ends name the same carrier.
     */
    through?: string;
};

/** A physical port. Ports a device does not declare are shut down. */
export type Port<V extends string, A extends string, L extends string, F extends string> = Routed<F> &
    Switched<V> & {
        /** What is plugged in. */
        description?: string;
        /** Largest IP packet, in bytes. 1500 when absent. */
        mtu?: number;
        /** Fixed speed, for an optic slower than the cage. Negotiated when absent. */
        speed?: "100m" | "1g" | "10g" | "25g" | "40g" | "50g" | "100g";
        /** Overrides the device's `lldp` for this port. */
        lldp?: boolean;
        /** Hardware ACL applied to traffic arriving on this port. */
        acl?: A;
        /** The LAG this port is in. Every other setting goes on the LAG. */
        lag?: L;
        /** Another of our devices at the other end of the cable. Without a `description`, the port is described from it: the far device and the far port as printed on it, such as `firewall-1 port6`. */
        link?: Link;
    };

/** Settings every interface that is not a physical port shares. */
type Base<F extends string> = Routed<F> & {
    /** What the interface is for. */
    description?: string;
    /** Largest IP packet, in bytes. */
    mtu?: number;
};

/** A layer 3 interface on a VLAN. */
export type VlanInterface<V extends string, F extends string> = Base<F> & {
    type: "vlan";
    /** The VLAN it is on. */
    vlan: V;
    /**
     * A MAC address of its own, instead of the one it shares with the device's other VLAN interfaces. A gateway in front of a transparent firewall needs one: frames to it come back on another VLAN, where the bridge would otherwise take a shared MAC for its own and keep them.
     */
    mac?: MacAddress;
};

/** An interface that is always up and is on no link, for addresses that must not depend on one. */
export type Loopback<F extends string> = Base<F> & { type: "loopback" };

/** A link aggregation. Each member port points to it with `lag`. */
export type Lag<V extends string, F extends string> = Base<F> &
    Switched<V> & {
        type: "lag";
        /** LACP negotiates membership with the far end; `static` joins the ports without asking. LACP when absent. */
        mode?: "lacp" | "static";
        /** Number, on platforms where a LAG has a number instead of a name. Its position among the device's LAGs when absent. */
        id?: number;
    };

/** A GRE tunnel. */
export type Gre<F extends string> = Base<F> & {
    type: "gre";
    /** Our tunnel endpoint. */
    local: IP;
    /** The far tunnel endpoint. */
    remote: IP;
};

/** A point-to-point VXLAN tunnel. */
export type Vxlan<F extends string> = Base<F> & {
    type: "vxlan";
    /** Segment identifier, the same on both ends. */
    vni: number;
    /** Our tunnel endpoint. */
    local: IP;
    /** The far tunnel endpoint. */
    remote: IP;
    /** UDP port. 4789 when absent. */
    port?: number;
    /** Fixed MAC address, so a rebuild keeps the one the far side learned. */
    mac?: MacAddress;
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
export type WireGuard<F extends string> = Base<F> & {
    type: "wireguard";
    /** UDP port peers connect to. */
    listen_port: number;
    /** The address clients connect to, for generated client configs. */
    endpoint?: IP;
    /** This interface's private key. Its public key is derived from it. */
    private_key: Secret;
    /** Who may connect. */
    peers?: readonly WireGuardPeer[];
};

/**
 * A layer 2 bridge between VLAN interfaces, each keeping its own VLAN: a frame that comes in on one member leaves another with that member's tag. A firewall filters what crosses it, by the rules of its forward chain between the members, without routing it.
 */
export type Bridge<F extends string> = Base<F> & {
    type: "bridge";
    /** The VLAN interfaces it joins, by name. Each has no address of its own. */
    members: readonly string[];
};

/** Any interface that is not a physical port. */
export type Interface<V extends string, F extends string> =
    VlanInterface<V, F> | Loopback<F> | Lag<V, F> | Gre<F> | Vxlan<F> | WireGuard<F> | Bridge<F>;
