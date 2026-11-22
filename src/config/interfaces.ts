import type { HostAddress, IP, IPv4, IPv6, InterfaceAddress, Limit, MacAddress, Named, Prefix, Rate, Secret } from "./common";
import type { RouteDistinguisher, VrfRouteTargets } from "./routing";

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

/** A host on an access port: its MAC address and the IP addresses it sends from. */
export type BoundHost = {
    /** The MAC address of the host's network card, or of a virtual machine bridged onto it, for example `02:00:00:00:00:01`. */
    mac: MacAddress;
    /** The IPv4 and IPv6 addresses it sends from. Each is an address, or a prefix routed to the host. Some addresses are always allowed, so don't list them. These are `0.0.0.0` while the host asks DHCP for an address, its IPv6 link-local addresses, and `::` while it checks that an address is free. */
    addresses: readonly (IP | Prefix)[];
};

/** A virtual router address shared with other devices on the same segment, RFC 9568 (VRRPv3). */
export type Vrrp = {
    /** Virtual router ID, 1 to 255. Use the same ID on every device that shares the address. */
    id: number;
    /** The shared address, without a length. */
    address: IP;
    /** Priority, 1 to 254. The device with the highest priority becomes the master. 100 when absent. */
    priority?: number;
    /** When this device comes back, it takes the master role back from a device with a lower priority. Off when absent. */
    preempt?: boolean;
    /** Seconds between advertisements. 1 when absent. */
    interval?: number;
};

/** This interface's connection to an internet exchange, as a registry such as PeeringDB lists it. The addresses are the interface's own. */
export type Exchange = {
    /** The exchange's name, shown in Circuit's output. */
    name: string;
    /** Capacity toward the exchange, in Mbit/s. */
    speed: number;
    /** The exchange LAN's id at PeeringDB, its `ixlan_id`. */
    peeringdb_ixlan?: number;
};

/** An address with its length. On a point-to-point link whose far end is outside the address's prefix, write `{ address, peer_address }`. */
export type Address =
    | InterfaceAddress
    | {
          /** Our address, with its length. */
          address: InterfaceAddress;
          /** The far end's address. */
          peer_address: IP;
      };

/** How a uRPF check decides (RFC 3704). */
export type UrpfMode = "strict" | "loose";

/** A prefix a router advertisement announces (RFC 4861), with what hosts may do with it. */
export type AdvertisedPrefix = {
    /** The prefix, such as `2001:db8:100:1::/64`. Hosts make their own addresses only in a /64. */
    prefix: Prefix;
    /** Seconds an address made from it stays valid. Up to 4294967295, which is forever. */
    valid_lifetime?: number;
    /** Seconds an address made from it is used for new connections, at most `valid_lifetime`. */
    preferred_lifetime?: number;
    /** Hosts make no address from it themselves, such as servers whose addresses are written by hand. It still tells them the prefix is on the link. */
    disable_autoconfiguration?: true;
};

/** What this interface's router advertisements say (RFC 4861). A field left out is the device's own default. */
export type RouterAdvertisement = {
    /** The most seconds between two advertisements, 4 to 1800. The device sends each one after a random time between a third of it and all of it. */
    interval?: number;
    /** Seconds hosts may use this router as their gateway, 0 to 9000. With 0, hosts don't use it as their gateway. Any other value is at least `interval`. */
    lifetime?: number;
    /** The prefixes it announces. Each IPv6 network of the interface when absent. */
    prefixes?: readonly AdvertisedPrefix[];
    /** The DNS servers it announces (RDNSS, RFC 8106). */
    dns_servers?: readonly IPv6[];
    /** The domains it announces (DNSSL, RFC 8106). A host adds one to a name without a domain, such as `mail` for `mail.example.net`. */
    dns_search_list?: readonly string[];
    /** Hosts take an address from a DHCPv6 server, such as `services.dhcpv6_server` (the M flag). */
    managed?: true;
    /** Hosts take other settings, such as DNS servers, from a DHCPv6 server (the O flag). */
    other_config?: true;
};

/** The uRPF check of each family. */
export type Urpf = {
    /** The check on IPv4 packets. */
    ipv4?: UrpfMode;
    /** The check on IPv6 packets. */
    ipv6?: UrpfMode;
};

/** Layer 3 settings shared by every interface that can have an address. `Vrf` is the device's VRF names. */
export type Routed<Vrf extends string> = {
    /** Addresses with their length. On a point-to-point link whose far end is outside the address's prefix, write `{ address, peer_address }`. */
    addresses?: readonly Address[];
    /**
     * Unicast reverse path forwarding (uRPF, RFC 3704): drop a packet that arrives here when its source fails the check. `strict` drops it unless the best route to its source leaves through this interface. `loose` drops it only when no route covers its source. A source routed to a blackhole fails both, so a blackhole route for an attacker's prefix also drops what it sends (source-based RTBH, RFC 5635). The device's own default when absent.
     *
     * RouterOS checks IPv4 only, with one mode for the whole router: write the same `ipv4` on every interface with an IPv4 address. Its `strict` beside VRFs or routing tables is experimental. FortiOS checks feasible paths (RFC 3704) by default. There `strict` is one setting for a whole VDOM: write it for each family on every interface in the VDOM with an address of that family. A Junos QFX switch doesn't check a packet whose source has several equal-cost routes. On VRP, `loose` also drops a source whose only route is the default route.
     */
    urpf?: Urpf;
    /** Send IPv6 router advertisements on this interface, so hosts find their gateway and make their own addresses. `true` announces each IPv6 network of the interface, with the device's own settings. Off when absent. */
    ipv6_ra?: boolean | RouterAdvertisement;
    /** Overrides `system.hardware_offload` for traffic routed through this interface. The firewall applies only to traffic forwarded in software. */
    hardware_offload?: boolean;
    /** Virtual router addresses on this interface. */
    vrrp?: readonly Vrrp[];
    /** The VRF this interface routes in, from `routing.vrfs`. The main table when absent. */
    vrf?: Vrf;
    /** Set it if this interface connects to an internet exchange. Circuit writes nothing to the device for it. `circuit sync peeringdb` publishes it to PeeringDB. */
    exchange?: Exchange;
};

/** Spanning tree settings for one port. */
export type PortStp = {
    /** The port connects to a host, never a switch, so it starts forwarding at once. */
    edge?: boolean;
    /** Path cost. Lower is preferred. Derived from speed when absent. */
    cost?: number;
    /** Port priority, 0 to 240 in steps of 16. Lower is preferred. */
    priority?: number;
    /** BPDU guard: a BPDU arriving on the port shuts it down, so a switch plugged into a host's port can't join the spanning tree. It stays down until someone brings it back up. Write it with `edge`. */
    bpdu_guard?: true;
    /** `root`, root guard: the port never becomes the root port. While a better root bridge is seen through it, the port blocks. Use it toward a switch that must never be the root, such as a customer's. */
    guard?: "root";
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

/** One VLAN that a port tags with another ID. `Vlan` is the device's VLAN names. */
export type VlanTranslation<Vlan extends string> = {
    /** The VLAN ID on this port's cable, 1 to 4094. */
    from: number;
    /** The VLAN it is switched in, from `trunk_vlans`. */
    to: Vlan;
};

/** Layer 2 membership. A port or LAG with none of these is routed. `Vlan` is the device's VLAN names. */
export type Switched<Vlan extends string> = {
    /** The one VLAN this port or LAG is in, untagged, from `switching.vlans`. */
    access_vlan?: Vlan;
    /** The VLANs this port or LAG carries, tagged, from `switching.vlans`. */
    trunk_vlans?: readonly Vlan[];
    /** The VLAN for untagged frames on a trunk, from `switching.vlans`. Only with `trunk_vlans`. */
    native_vlan?: Vlan;
    /**
     * QinQ: every frame that arrives on this port or LAG, tagged or not, takes this VLAN's tag on top, and a frame that leaves loses it. So a customer's own VLANs cross your network inside one VLAN, from `switching.vlans`. A trunk carries it as any other VLAN, each frame 4 bytes longer, with the trunk's `tpid`. DHCP snooping, ARP inspection, and RA guard don't look inside it. Not with `access_vlan` or `trunk_vlans`.
     */
    qinq_vlan?: Vlan;
    /**
     * The TPID of the VLAN tags this port or LAG sends and takes, OpenConfig's `tpid`. `0x88a8` is IEEE 802.1ad's service tag (S-tag), such as on a trunk that carries QinQ VLANs to another provider. A frame tagged with another TPID counts as untagged: an access port with `0x88a8` takes a frame tagged 0x8100 into its VLAN, with its tag inside. Write the same at the far end. `0x8100`, 802.1Q's customer tag, when absent.
     */
    tpid?: "0x8100" | "0x88a8";
    /**
     * VLAN translation (IEEE 802.1Q's VID translation): a frame that arrives tagged `from` is switched in VLAN `to`, and a frame of `to` leaves tagged `from`. So a switch or a customer on the far end keeps its own VLAN IDs, such as `[{ from: 20, to: "mgmt" }]`. Each `to` is one of `trunk_vlans`, once. No `from` is the ID of a VLAN the port carries.
     */
    vlan_translation?: readonly VlanTranslation<Vlan>[];
    /** Overrides `switching.stp` for this port. With `false`, the port sends no BPDUs and ignores the ones it gets. */
    stp?: boolean | PortStp;
    /** Drop flooded traffic above these thresholds. */
    storm_control?: StormControl;
    /** The most MAC addresses this port or LAG learns, 1 or more. It drops frames from any other source MAC. An exchange sets 1 on a member's port, so each member sends from one router only. No limit when absent. */
    mac_limit?: number;
    /** The only kinds of frame this port or LAG takes in. It drops every other kind. An exchange allows `ipv4`, `ipv6`, and `arp` on a member's port. Every kind when absent. */
    ethertypes?: readonly Ethertype[];
    /**
     * The only hosts allowed on this access port. The port takes frames and ARP only from their MAC addresses, and IP packets only from their addresses. It also takes the addresses every host sends from: `0.0.0.0` for DHCP, IPv6 link-local, and `::`. It drops everything else, so a host can't pretend to be its neighbor. For a server with a management card on the same cable, or with virtual machines bridged onto it, list each MAC. Any host when absent.
     */
    bound_to?: readonly BoundHost[];
    /** DHCP servers' messages may arrive on this port or LAG, such as the uplink toward the DHCP server. Only with `switching.dhcp_snooping`. */
    dhcp_trusted?: true;
    /** Router advertisements may arrive on this port or LAG, such as the uplink toward the router. Only with `switching.ra_guard`. */
    ra_trusted?: true;
};

/**
 * The other end of a cable: another of your devices, and its port. Both ends must agree on how they are switched, and the far end must link back to this port.
 *
 * Write the far end in the port's `description`, as `<far device> <far port as that device prints it>`, such as `fw-01 port6`. Circuit warns if it doesn't match, but never writes it for you.
 */
export type Link = {
    /** The device at the other end, by its `name`. */
    device: string;
    /** The port on that device, such as `10g-2`. */
    port: string;
    /**
     * What is between the two ends when the cable is not direct, such as a carrier's local loop or layer 2 transport: `"Zayo local loop"`. LLDP then sees the carrier's switches, not the far end, so Circuit doesn't check LLDP on this port. Write the same carrier at both ends.
     */
    through?: string;
};

/** Where a DHCP client puts the default route from its server: a table, at a distance. */
export type DhcpDefaultRoute<Table extends string> = {
    /** One of `routing.tables`, or `main`. `main` when absent. */
    routing_table?: Table | "main";
    /** Preference among routes to the same prefix. Lower wins. 1 when absent. */
    distance?: number;
};

/** Take an IPv4 address from a DHCP server on the link, such as an ISP's modem. The device doesn't use the DNS and time servers the DHCP server offers. It uses `system.dns` and `system.ntp`. */
export type DhcpClient<Table extends string> = {
    /** Where the default route from the server goes: each table, at its distance. The main table at distance 1 when absent. An empty list installs no default route. */
    default_routes?: readonly DhcpDefaultRoute<Table>[];
};

/** A physical port, by its key `<speed>-<position>`, such as `10g-4`. Circuit shuts down every port the device doesn't list. */
export type Port<
    Vlan extends string,
    Acl extends string,
    Lag extends string,
    Vrf extends string,
    Table extends string = string,
    Scheduler extends string = string,
> = Routed<Vrf> &
    Switched<Vlan> & {
        /** What is plugged in. On a port with a `link`, write the far end as `<far device> <far port as that device prints it>`. */
        description?: string;
        /** Largest IP packet, in bytes. 1500 when absent. */
        mtu?: number;
        /** Fixed speed, for an optic slower than the cage. Negotiated when absent. */
        speed?: "100m" | "1g" | "10g" | "25g" | "40g" | "50g" | "100g";
        /** Overrides `switching.lldp` for this port. */
        lldp?: boolean;
        /** The hardware ACL for traffic that arrives on this port, from `switching.acls`. */
        ingress_acl?: Acl;
        /** The LAG this port is in, from `interfaces.lag`. Write every other setting on the LAG. */
        in_lag?: Lag;
        /** Your device at the other end of the cable. Circuit checks that it links back, and warns if `description` doesn't match it. */
        link?: Link;
        /** Also take an IPv4 address from a DHCP server on the link, besides any in `addresses`. Off when absent. */
        dhcp_client?: DhcpClient<Table>;
        /** Limits the traffic that leaves through this port to a rate, with a queue. Not limited when absent. */
        shaping?: Shaping;
        /** Limits the traffic through this port, each way. Not limited when absent. */
        rate_limit?: RateLimit;
        /** How this port sends what leaves it, by class: one of `qos.schedulers`. One queue, first in first out, when absent. */
        scheduler?: Scheduler;
    };

/** Limits the traffic through an interface to a rate, each way. Traffic above the rate waits in a queue or is dropped, as the platform does. */
export type RateLimit = {
    /** The traffic that arrives on the interface. */
    input?: Limit;
    /** The traffic that leaves through the interface. */
    output?: Limit;
    /** Limits each prefix on the interface's side on its own as well, such as each customer on a VLAN interface. Only the interface as a whole when absent. */
    per_prefix?: PerPrefix;
};

/**
 * A rate for each prefix of these lengths, such as `{ ipv4: 32, ipv6: 64, input: "5M", output: "20M" }` for each IPv4 address and each IPv6 /64. What arrives is counted by its source, and what leaves by its destination, so write it on the interface toward the customers. A customer's IPv4 and IPv6 traffic each get the rates. Beside `input` and `output` of the interface as a whole, the prefixes share those.
 */
export type PerPrefix = {
    /** 32 for each address, or shorter, such as 30, for each network of that length. */
    ipv4: number;
    /** 128 for each address, or shorter, such as 64 or 56, for each customer's network. */
    ipv6: number;
    /** What each prefix sends: the traffic from it that arrives on the interface. */
    input?: Rate;
    /** What each prefix gets: the traffic to it that leaves through the interface. */
    output?: Rate;
};

/**
 * Limits the traffic that leaves through an interface to a rate, with a queue. CAKE is FQ-CoDel (RFC 8290) with its own shaper. It keeps latency low under load if the rate is a little below the slowest link on the path.
 */
export type Shaping = {
    /** The queue: `cake`. */
    algorithm: "cake";
    /** The rate limit, in Mbit/s. */
    mbps: number;
};

/** Settings every interface that is not a physical port shares. */
export type Base<Vrf extends string> = Routed<Vrf> & {
    /** What the interface is for. */
    description?: string;
    /** Largest IP packet, in bytes. */
    mtu?: number;
    /** Limits the traffic that leaves through this interface to a rate, with a queue. Not limited when absent. */
    shaping?: Shaping;
};

/** A layer 3 interface on a VLAN. */
export type VlanInterface<Vlan extends string, Vrf extends string, Scheduler extends string = string> = Base<Vrf> & {
    /** The VLAN it is on, from `switching.vlans`. With `inner_vlan_id`, its tag is the outer one. */
    vlan: Vlan;
    /**
     * QinQ: the ID of the inner tag, 1 to 4094, OpenConfig's `inner-vlan-id`. The interface ends one customer VLAN inside `vlan`, as a BNG or a PE does. It takes the frames of `vlan` whose inner tag has this ID, and sends its own with both tags, such as `{ vlan: "olt-3", inner_vlan_id: 1001 }`. The outer tag has the `tpid` of the ports that carry `vlan`, and the inner tag is 0x8100.
     */
    inner_vlan_id?: number;
    /**
     * A MAC address of its own, instead of the one it shares with the device's other VLAN interfaces. A gateway in front of a transparent firewall needs one. Frames to it come back on another VLAN, and with a shared MAC the bridge would take them as its own and keep them.
     */
    mac?: MacAddress;
    /**
     * Addresses in its subnet that are really somewhere else. It answers ARP for them with its own MAC, then routes their traffic. Use it for an address you moved out of the subnet to another link, which the hosts on the subnet still think is a neighbor. None when absent.
     */
    proxy_arp?: readonly IP[];
    /** Limits the traffic through this VLAN interface, each way. Not limited when absent. */
    rate_limit?: RateLimit;
    /** How this VLAN interface sends what leaves it, by class: one of `qos.schedulers`. One queue, first in first out, when absent. */
    scheduler?: Scheduler;
};

/** An interface that is always up and is not on any link. Use it for addresses that must not depend on a link. No packet arrives on it, so it has no `urpf`. */
export type Loopback<Vrf extends string> = Omit<Base<Vrf>, "urpf">;

/**
 * How a LAG finds a member that no longer carries traffic. Every `interval_ms`, the LAG sends an ARP request to each target over every member. A member that gets no reply leaves the LAG until it gets one again. Use it for members whose link stays up when the path behind them fails, such as tunnels.
 */
export type LinkCheck = {
    /** The addresses to ask, in the LAG's own subnet, such as the far end's address on the LAG. */
    arp_targets: readonly IP[];
    /** Milliseconds between requests. */
    interval_ms: number;
};

/** A link aggregation. Each member port or EoIP tunnel points to it with `in_lag`. */
export type Lag<Vlan extends string, Vrf extends string, Scheduler extends string = string> = Base<Vrf> &
    Switched<Vlan> & {
        /**
         * How the members join. `lacp` agrees on the members with the far end. `static` joins them without asking. `round_robin` sends each packet over the next member in turn, so one flow uses every member (Linux's balance-rr), and it uses no LACP. `lacp` when absent.
         */
        mode?: "lacp" | "static" | "round_robin";
        /** The LAG's number, on platforms where a LAG has a number, not a name. Its position among the device's LAGs when absent. */
        id?: number;
        /** Use ARP to find a member that no longer carries traffic, and take it out. When absent, only each member's link state counts. */
        link_check?: LinkCheck;
        /** A fixed MAC address. Without it, the LAG takes a member's MAC. A tunnel may make up a new MAC each time the device starts, while the far end keeps the old one in its ARP table. */
        mac?: MacAddress;
        /** Limits the traffic through this LAG, each way. Not limited when absent. */
        rate_limit?: RateLimit;
        /** How this LAG sends what leaves it, by class: one of `qos.schedulers`. One queue, first in first out, when absent. */
        scheduler?: Scheduler;
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
    /** The VXLAN segment ID, 1 to 16777215. Use the same ID on both ends. */
    vni: number;
    /** Our tunnel endpoint, alone or with its length. */
    local_address: HostAddress;
    /** The far tunnel endpoint. */
    remote_address: IP;
    /** UDP port. 4789 when absent. */
    port?: number;
    /** A fixed MAC address, so the tunnel keeps the MAC the far end learned, even after it is rebuilt. */
    mac?: MacAddress;
    access_vlan?: never;
    evpn?: never;
};

/** The EVPN instance of one VXLAN segment: the EVPN routes it sends and takes over BGP. */
export type VxlanEvpn = {
    /** Keeps this segment's EVPN routes apart from another's inside BGP, such as `192.0.2.1:10100`: this VTEP's address and a number (RFC 7432, section 7.9). Each EVPN segment and VRF of the device has its own. */
    route_distinguisher: RouteDistinguisher;
    /**
     * Which EVPN routes the segment takes, and which its own carry, such as `{ import: ["64500:10100"], export: ["64500:10100"] }`. It learns the far VTEPs (type 3 routes) and the MAC addresses behind them (type 2) from the routes with an `import` target. Each VTEP of the segment writes the same targets.
     */
    route_targets: VrfRouteTargets;
};

/**
 * A VXLAN segment (RFC 8365) that is a port of a VLAN, as a pseudowire is. BGP EVPN (RFC 7432) finds its far VTEPs and the MAC addresses behind each, so it has no `remote_address`. Each VTEP announces itself in a type 3 route, and each MAC address it learns in a type 2 route. It floods broadcasts to every far VTEP, one copy each (ingress replication).
 */
export type EvpnVxlan<Vlan extends string> = {
    /** What the segment carries. */
    description?: string;
    /** The VXLAN segment ID, 1 to 16777215. Use the same ID on every VTEP of the segment. */
    vni: number;
    /** Our VTEP address, alone or with its length, such as the loopback's. The far VTEPs send the segment's frames to it. */
    local_address: HostAddress;
    /** UDP port. 4789 when absent. Use the same port on every VTEP of the segment. */
    port?: number;
    /** A fixed MAC address for the segment's interface. */
    mac?: MacAddress;
    /** The VLAN the segment is a port of, from `switching.vlans`. Its frames cross without the VLAN's tag, so the VLAN ID may differ on each VTEP. */
    access_vlan: Vlan;
    /** BGP EVPN finds the far VTEPs and the MAC addresses behind them. */
    evpn: VxlanEvpn;
    remote_address?: never;
} & { [K in Exclude<keyof Base<string>, "description">]?: never };

/**
 * An Ethernet over IP tunnel (EoIP): MikroTik's GRE tunnel that carries Ethernet frames, IP protocol 47. It carries layer 2 between two routers, so it can be a member of a LAG. Both ends use the same `tunnel_id`.
 */
export type Eoip<Lag extends string, Vrf extends string> = Base<Vrf> & {
    /** Our tunnel endpoint, alone or with its length. */
    local_address: HostAddress;
    /** The far tunnel endpoint. */
    remote_address: IP;
    /** The tunnel's number, 0 to 65535. Use the same number on both ends, and a different one for each EoIP tunnel on the device. */
    tunnel_id: number;
    /** The LAG this tunnel is a member of, from `interfaces.lag`. */
    in_lag?: Lag;
};

/**
 * An Ethernet pseudowire (RFC 4448) across the MPLS core to another PE, set up by LDP with the PWid FEC (RFC 8077). It is a port of the device in its VLANs, with one of `access_vlan`, `trunk_vlans`, and `qinq_vlan`, as a port is. With a customer's port in the same VLAN, it carries that port's frames to the far PE: a point-to-point service, VPWS. With several pseudowires in one VLAN, the PEs make a VPLS (RFC 4762), and a frame from one pseudowire never leaves by another. Needs `routing.mpls`.
 */
export type Pseudowire<Vlan extends string> = {
    /** What it carries, such as the customer and its far site. */
    description?: string;
    /** The far PE's LSR ID, its `routing.mpls.ldp.lsr_id`. */
    peer: IPv4;
    /** The pseudowire's ID, 1 to 4294967295, the same at both ends. Each pseudowire of the device to one peer has its own. */
    pw_id: number;
    /** The one VLAN it is in, from `switching.vlans`. Its frames cross the pseudowire without the VLAN's tag, raw mode (RFC 4448, section 4.4.1), and it takes untagged frames only. */
    access_vlan?: Vlan;
    /**
     * The VLANs it carries, from `switching.vlans`. Each frame crosses the pseudowire with its VLAN's tag: tagged mode, PW type 4 (RFC 4448, section 4.4.1). At the far PE, it joins the VLAN of that ID. Every frame crosses tagged, so there is no native VLAN. Write the same VLAN IDs on the pseudowire back, in `trunk_vlans` too: RFC 4448 wants both ends tagged, or both untagged.
     */
    trunk_vlans?: readonly Vlan[];
    /**
     * QinQ, from `switching.vlans`: every frame from the far PE, tagged or not, takes this VLAN's tag on top, and a frame that leaves by the pseudowire loses it. So a customer's own VLANs cross inside one VLAN of yours, each frame with its tags, raw mode (RFC 4448, section 4.4.1).
     */
    qinq_vlan?: Vlan;
    /** The MTU the pseudowire tells the far PE, in bytes: the largest frame it carries, without its Ethernet header (RFC 8077, section 6.4). Write the same at the far PE: RFC 8077 keeps the pseudowire down otherwise. The platform's own when absent, 1500 on RouterOS. */
    mtu?: number;
    /** Put the control word (RFC 4385) in front of each frame. A P router that shares traffic out among links then never takes a frame for an IP packet (RFC 4448, section 4.6). The platform's own when absent, without it on RouterOS. */
    control_word?: boolean;
};

/** An encryption algorithm with its key length in bits (IANA, IKEv2 transform type 1). A `gcm` one also protects integrity (AEAD, RFC 4106 and RFC 5282), so it takes no `integrity`. */
export type IpsecEncryption = "aes-128-cbc" | "aes-256-cbc" | "aes-128-gcm" | "aes-256-gcm";

/** An integrity algorithm (IANA, IKEv2 transform type 3): HMAC with SHA-256 or SHA-512, which sends the first 128 or 256 bits of the result (RFC 4868). */
export type IpsecIntegrity = "hmac-sha2-256-128" | "hmac-sha2-512-256";

/** A Diffie-Hellman group by its IANA number: 14, 15, and 16 are MODP groups of 2048, 3072, and 4096 bits (RFC 3526). 19, 20, and 21 are elliptic curve groups of 256, 384, and 521 bits (RFC 5903). */
export type DhGroup = 14 | 15 | 16 | 19 | 20 | 21;

/** The IKE SA (RFC 7296), which authenticates the peer and makes the keys of the ESP SA. Both ends need the same algorithms. */
export type IpsecIke = {
    encryption: IpsecEncryption;
    /** Needed with a `cbc` encryption, and only with one. */
    integrity?: IpsecIntegrity;
    /** The pseudorandom function that makes the keys (IANA, IKEv2 transform type 2, RFC 4868). */
    prf: "hmac-sha2-256" | "hmac-sha2-512";
    dh_group: DhGroup;
    /** Seconds before the IKE SA is made again, with new keys. */
    lifetime: number;
};

/** The ESP SA (RFC 4303), which encrypts the packets in the tunnel. Both ends need the same algorithms. */
export type IpsecEsp = {
    encryption: IpsecEncryption;
    /** Needed with a `cbc` encryption, and only with one. */
    integrity?: IpsecIntegrity;
    /** A Diffie-Hellman exchange of this group each time the SA is made again (perfect forward secrecy). Without it, the new keys come from the IKE SA's. */
    pfs_group?: DhGroup;
    /** Seconds before the SA is made again, with new keys. */
    lifetime: number;
};

/**
 * Liveness checks (RFC 7296 §2.4), also called dead peer detection. When nothing has come from the peer for `interval` seconds, the device asks whether it is still there, with an empty IKE request. A peer that leaves `retries` requests in a row unanswered is dead, and the tunnel goes down until IKE sets it up again.
 */
export type IpsecLivenessCheck = {
    /** Seconds without a packet from the peer before the device asks, and between two requests. */
    interval: number;
    /** How many requests in a row may go unanswered before the peer is dead. */
    retries: number;
};

/**
 * Who the peer must be, as an IKEv2 identity (RFC 7296 §3.5), matched against its certificate as RFC 4945 §3.1 says. Write one of the four.
 */
export type IpsecIdentity =
    | {
          /** The attributes the certificate's subject must hold, each with exactly this value, as RFC 4514 writes a name: `CN=branch-1,O=Example` (ID_DER_ASN1_DN, RFC 4945 §3.1.5). */
          distinguished_name: string;
          fqdn?: never;
          email?: never;
          address?: never;
      }
    | {
          /** A domain name the certificate holds as a `dNSName` in its subject alternative names (ID_FQDN, RFC 4945 §3.1.2). */
          fqdn: string;
          distinguished_name?: never;
          email?: never;
          address?: never;
      }
    | {
          /** An email address the certificate holds as an `rfc822Name` in its subject alternative names (ID_RFC822_ADDR, RFC 4945 §3.1.3). */
          email: string;
          distinguished_name?: never;
          fqdn?: never;
          address?: never;
      }
    | {
          /** An IP address the certificate holds as an `iPAddress` in its subject alternative names (ID_IPV4_ADDR or ID_IPV6_ADDR, RFC 4945 §3.1.1). */
          address: IP;
          distinguished_name?: never;
          fqdn?: never;
          email?: never;
      };

/** How each end proves who it is (RFC 7296 §2.15): with a key both ends share, or with its own certificate, signed by a CA the other end trusts. `Identity` is what `remote_identity` takes: `never` where a tunnel takes none yet. */
export type IpsecAuthentication<C extends string, Identity = IpsecIdentity> =
    | {
          /** The key both ends share. */
          pre_shared_key: Secret;
          certificate?: never;
          ca_certificate?: never;
          remote_identity?: never;
      }
    | {
          /** This end's certificate, one of `system.certificates` with its private key. The device signs with it, and sends it to the peer (RFC 7296 §3.6). */
          certificate: C;
          /**
           * The CA that signed the peer's certificate: one of `system.certificates`, without its private key. Without `remote_identity`, the device takes any certificate this CA signed, so use a CA that signs only your own tunnel ends.
           */
          ca_certificate: C;
          /** Who the peer must be: the device takes only a certificate of `ca_certificate`'s that holds this identity. Any certificate that CA signed when absent. */
          remote_identity?: Identity;
          pre_shared_key?: never;
      };

/**
 * What every IPsec tunnel to one peer holds, route-based or policy-based: its endpoints and the algorithms of its SAs. IKEv2 (RFC 7296) authenticates the peer with a key both ends share, or with certificates. `presets.ipsec_rfc8247` holds IKE algorithms every IKEv2 peer has.
 */
export type IpsecTunnel<C extends string = string, Identity = IpsecIdentity> = {
    /** Our tunnel endpoint, alone or with its length. */
    local_address: HostAddress;
    /** The far tunnel endpoint. */
    remote_address: IP;
    ike: IpsecIke;
    esp: IpsecEsp;
} & IpsecAuthentication<C, Identity>;

/**
 * A route-based IPsec tunnel (RFC 4301) to one peer: what is routed into the interface leaves encrypted with ESP, so BGP or OSPF can run over it. It carries IPv4, and IPv6 too once one of its `addresses` is IPv6. For a tunnel without an interface, see `firewall.ipsec`.
 */
export type Ipsec<C extends string = string> = Pick<Base<never>, "description" | "addresses"> &
    IpsecTunnel<C> & {
        /** Ask a silent peer whether it is still there, so a dead peer takes the tunnel down. With `false`, the device never asks. The device's own default when absent. */
        liveness_check?: false | IpsecLivenessCheck;
        /**
         * NAT traversal (RFC 7296 §2.23). When IKE finds a NAT between the ends, both put ESP in UDP on port 4500 (RFC 3948). The end behind the NAT sends keepalives, so the NAT keeps its mapping. `always` puts ESP in UDP even when there is no NAT, for a path that drops ESP. Only when IKE finds a NAT, when absent.
         */
        nat_traversal?: "always";
        /** Seconds between the NAT-keepalive packets (RFC 3948 §2.3) this end sends while it is behind a NAT. Use it for a NAT that forgets an idle mapping sooner than the device's own interval. The device's own interval when absent. */
        nat_keepalive?: number;
    };

/** A host and a UDP port, `host:port`, for example `203.0.113.10:51820` or `vpn.example.net:51820`. */
export type Endpoint = `${string}:${number}`;

/** One peer of a WireGuard interface. */
export type WireGuardPeer = {
    /** Who or what the peer is. */
    name: string;
    /** The peer's public key. Public keys are not secrets. */
    public_key: string;
    /** The addresses the peer may send from. Traffic to them goes to this peer. */
    allowed_addresses: readonly Prefix[];
    /** The peer's `host:port`, if this side connects to it. When absent, the peer connects in. */
    endpoint?: Endpoint;
    /** Seconds between keepalives, for a peer behind NAT. None when absent. */
    keepalive?: number;
    /** What a generated client config sends into the tunnel. It changes nothing on this device. */
    client_allowed_addresses?: readonly Prefix[];
};

/** A WireGuard interface. */
export type WireGuard<Vrf extends string, Table extends string = string> = Base<Vrf> & {
    /** UDP port peers connect to. */
    listen_port: number;
    /** The table that routes the tunnel's own packets to its peers, from `routing.tables`. Use a table that leaves through one uplink only, so the tunnel never moves to another uplink. The main table when absent. */
    routing_table?: Table;
    /** The address clients connect to, alone or with its length. Generated client configs use it. */
    endpoint?: HostAddress;
    /** This interface's private key. The public key comes from it. */
    private_key: Secret;
    /** Who may connect. */
    peers?: readonly WireGuardPeer[];
};

/**
 * A layer 2 bridge between VLAN interfaces, each keeping its own VLAN. A frame that comes in on one member leaves another with that member's tag. A firewall filters the traffic that crosses it with its forward chain, without routing it.
 */
export type Bridge<VlanInterface extends string, Vrf extends string> = Omit<Base<Vrf>, "description" | "urpf"> & {
    /** What the bridge is for. On FortiOS it is documentation only: there a bridge is a forward domain, which has no place for it. */
    description?: string;
    /** The VLAN interfaces it joins, from `interfaces.vlan_interface`. They have no addresses of their own. */
    member_interfaces: readonly VlanInterface[];
};

/**
 * An IPv6 prefix a PPPoE client asks its server for (DHCPv6 prefix delegation, RFC 9915), as a home router does (RFC 7084). The router gives each of `interfaces` a /64 of it, so a /64 delegated serves one.
 */
export type ClientPrefixDelegation<I extends string> = {
    /** The prefix it asks for, with its length, such as `2001:db8:100:a500::/56`: a prefix hint (RFC 9915 §18.2.1). The server may give it when it is free, or give another prefix, and the router takes what it gets. A router that holds a prefix asks for that one again, so a changed hint takes effect only when it next asks for a new prefix. It holds its length, so write it in place of `prefix_length`, not beside it. No prefix is asked for when both are absent. */
    prefix?: Prefix;
    /** The length of the prefix it asks for, such as 56: a prefix-length hint (RFC 8168). The server may give another length, and the router takes it. To ask for a whole prefix, write `prefix` instead. No length is asked for when absent. */
    prefix_length?: number;
    /** The ports and interfaces that each take a /64 of the delegated prefix, with the router's address in it written by its last 64 bits, such as `{ home: "::1" }`. One with `ipv6_ra` announces its /64, so hosts there make their own addresses. */
    interfaces: Named<I, IPv6>;
};

/**
 * A PPPoE client (RFC 2516): the session the router opens over `interface` to its provider's PPPoE server, logged in with `user` and `password`. The server gives it its IPv4 address (IPCP, RFC 1332), so it has no `addresses`. A route through it, such as the default route, is a static route with `interface`, and a source NAT matches it with `out_interface`. The router uses `system.dns`, not the resolvers the server offers.
 */
export type PppoeClient<Carrier extends string, I extends string, Vrf extends string = string> = {
    /** The port, LAG, or VLAN interface it runs over, toward the provider. It holds no address for the session. */
    interface: Carrier;
    /** What the link is for, such as the provider and the circuit ID. */
    description?: string;
    /** The name it logs in with, as the provider gave it. */
    user: string;
    /** The password it logs in with. */
    password: Secret;
    /** The service name it asks for (RFC 2516). A server that offers another name does not answer. Any server answers when absent. */
    service_name?: string;
    /** The largest packet the session carries, in bytes. RFC 2516 allows 1492 at most. The platform agrees on one with the server when absent. */
    mtu?: number;
    /** Ask the server for an IPv6 prefix over the session. No IPv6 prefix when absent. */
    prefix_delegation?: ClientPrefixDelegation<I>;
    /** Make an IPv6 address on the session from the /64 the server announces in its router advertisements (SLAAC, RFC 4862). The router takes the default route they carry too, as a host does (RFC 4861). The session takes it when it next comes up. No IPv6 address on the session when absent. */
    slaac?: true;
    /** The VRF the session routes in, from `routing.vrfs`, such as one that keeps a provider's internet apart from the main table. Its address is there, and a route through it is written with that `vrf`. The main table when absent. */
    vrf?: Vrf;
};

/**
 * Every port and interface, by kind, each keyed by its name. A port's key is `<speed>-<position>` from the model.
 *
 * The type parameters are the names the device declares: `Ethernet` the ports, `L` LAGs, `VI` VLAN interfaces, `T` the other interfaces, `V` VLANs, `F` VRFs, `Table` routing tables, `Certificate` certificates. `S` is its schedulers, and `I` every port and interface.
 */
export type Interfaces<
    Ethernet,
    L extends string,
    VI extends string,
    T extends string,
    V extends string,
    F extends string,
    Table extends string = string,
    Certificate extends string = string,
    I extends string = string,
    S extends string = string,
> = {
    /** Physical ports, keyed by `<speed>-<position>` from the model, such as `10g-4`. Ports not listed are shut down. */
    ethernet?: Ethernet;
    /** Link aggregations, keyed by name. Each member port points to one with `in_lag`. */
    lag?: Named<L, Lag<V, F, S>>;
    /** Layer 3 interfaces on a VLAN, keyed by name. Each gives its VLAN in `vlan`. */
    vlan_interface?: Named<VI, VlanInterface<V, F, S>>;
    /** Layer 2 bridges between VLAN interfaces, keyed by name. */
    bridge?: Named<T, Bridge<NoInfer<VI>, F>>;
    /** Loopback interfaces, keyed by name. They are always up and on no link. */
    loopback?: Named<T, Loopback<F>>;
    /** GRE tunnels, keyed by name. */
    gre?: Named<T, Gre<F>>;
    /** VXLANs, keyed by name: point-to-point tunnels, and segments that are ports of a VLAN, whose far VTEPs BGP EVPN finds. */
    vxlan?: Named<T, Vxlan<F> | EvpnVxlan<V>>;
    /** Route-based IPsec tunnels, keyed by name. */
    ipsec?: Named<T, Ipsec<Certificate>>;
    /** WireGuard interfaces, keyed by name. */
    wireguard?: Named<T, WireGuard<F, Table>>;
    /** Ethernet tunnels over IP, keyed by name. Each may be a member of a LAG with `in_lag`. */
    eoip?: Named<T, Eoip<NoInfer<L>, F>>;
    /** Ethernet pseudowires to other PEs, keyed by name. Each is a port in its VLANs. */
    pseudowire?: Named<T, Pseudowire<V>>;
    /** PPPoE clients, keyed by name: each a session to a provider over a port, a LAG, or a VLAN interface. */
    pppoe_client?: Named<T, PppoeClient<NoInfer<(keyof Ethernet & string) | L | VI>, I, F>>;
};
