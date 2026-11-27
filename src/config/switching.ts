import type { Family, Limit, Named, OneOrMore, Ordered, Prefix } from "./common";
import type { Ports, Protocol } from "./firewall";
import type { RouteDistinguisher, VrfRouteTargets } from "./routing";

/** A secondary VLAN of a private VLAN (RFC 5517): its hosts are in the primary VLAN's subnet, but kept apart at layer 2. */
export type PrivateVlan<V extends string> = {
    /** The primary VLAN, from `switching.vlans`. Its access ports, the trunks that carry it, and its VLAN interface are promiscuous: they reach every host of its secondary VLANs. */
    primary: V;
    /** `isolated`: a host here reaches the promiscuous ports only. A primary VLAN has one isolated VLAN at most. `community`: a host here also reaches the other hosts of this VLAN. */
    type: "isolated" | "community";
};

/**
 * A VPLS whose PEs BGP finds, with the names of OpenConfig's network instance. With `site_id`, BGP sets up the pseudowires too (RFC 4761). With `vpls_id`, LDP does (RFC 6074). Every PE of one VPLS writes the same one of the two.
 */
export type Vpls = {
    /** Keeps the VPLS's BGP routes apart from another VPN's, such as `64500:300`. Each VRF and VPLS of the device has its own. */
    route_distinguisher: RouteDistinguisher;
    /** Which PEs the VLAN joins, such as `{ import: ["64500:300"], export: ["64500:300"] }`. The device sets up a pseudowire to each PE whose VPLS route carries an `import` target, and its own route carries the `export` targets. */
    route_targets: VrfRouteTargets;
} & (
    | {
          /** This PE's number in the VPLS, 1 to 65535: its VE ID (RFC 4761, section 3.2.1), OpenConfig's `site-id`. BGP then sets up the pseudowires too. Each PE of the VPLS has its own. */
          site_id: number;
          vpls_id?: never;
      }
    | {
          /** The VPLS's ID, the same at each of its PEs, written as a route distinguisher is, such as `64500:300`: its VPLS-id (RFC 4762, section 6.1.1). BGP then only finds the PEs (RFC 6074), and LDP sets up each pseudowire with the generalized PWid FEC (RFC 8077, section 6.2). */
          vpls_id: RouteDistinguisher;
          site_id?: never;
      }
);

/**
 * A VLAN. Its key in `switching.vlans` is its name. `Untrusted` is whether the network turns on the check `untrusted_vlans`, which `untrusted` needs. `V` is the device's VLAN names.
 */
export type Vlan<Untrusted extends boolean = true, V extends string = string> = {
    /** The VLAN ID on the wire, 1 to 4094. Two VLANs on a device can't share an ID. */
    id: number;
    /** What the VLAN is for. On a platform where a VLAN is only its number (Raisecom, FortiOS), Circuit doesn't write it, so the same VLAN works on every platform. */
    description?: string;
    /**
     * The VLAN carries traffic straight from outside, such as a transit, an exchange, an ISP handoff, or the native VLAN of one of these. The check `untrusted_vlans` uses it, and the device never gets it. Write it on every device that declares the VLAN. Allowed only when the network's `circuit()` turns on `untrusted_vlans`. Otherwise the editor shows an error and `circuit validate` stops.
     */
    untrusted?: Untrusted extends true ? true : "allowed only when circuit.ts turns on the check untrusted_vlans";
    /** Makes this a secondary VLAN of a private VLAN (RFC 5517). Only access ports may be in it: a trunk carries its primary VLAN, and the gateway's VLAN interface is on the primary VLAN too. */
    private_vlan?: PrivateVlan<V>;
    /**
     * Makes the VLAN a VPLS across the MPLS core whose PEs BGP finds, such as `{ route_distinguisher: "64500:300", route_targets: { import: ["64500:300"], export: ["64500:300"] }, site_id: 1 }`. The device sets up a pseudowire to each other PE of the VPLS by itself, where `interfaces.pseudowire` writes one per PE. Each is a port of the VLAN whose frames cross without the VLAN's tag, raw mode (RFC 4448), and a frame from one never leaves by another. Needs `routing.mpls`, and a BGP neighbor whose `address_families` has `l2vpn-vpls`.
     */
    vpls?: Vpls;
};

/** VLAN IDs from `min` to `max`, both included. */
export type VlanRange = {
    /** The first VLAN ID, 1 to 4094. */
    min: number;
    /** The last VLAN ID, 1 to 4094, not below `min`. */
    max: number;
};

/**
 * Which packets an ACL rule applies to. All must be true.
 *
 * `vlan`, `src`, and `dst` each take a list. If the platform has no lists, Circuit writes one rule for each combination, in this order: VLAN first, then `src`, then `dst`. A `src` and a `dst` of different families match no packet, so Circuit leaves that combination out. If no combination is left, the rule is an error.
 */
export type AclMatch<V extends string> = {
    /** Only packets of this family. */
    family?: Family;
    /** IP protocol. */
    protocol?: Protocol;
    /** Source prefix, or any of several. */
    src?: OneOrMore<Prefix>;
    /** Destination prefix, or any of several. */
    dst?: OneOrMore<Prefix>;
    /** Source port, or any of several. */
    src_port?: Ports;
    /** Destination port, or any of several. */
    dst_port?: Ports;
    /** Only packets in this VLAN, or in any of several, from `switching.vlans`. */
    vlan?: OneOrMore<V>;
};

/**
 * A stateless rule the hardware runs where traffic arrives, before routing. The condition comes first: `{ if: { vlan: "ix", src: "10.0.0.0/8" }, then: "drop" }`. Without `if`, it applies to every packet.
 */
export type AclRule<V extends string> = {
    /** Shown beside the rule on the device. */
    description?: string;
    /** Which packets the rule applies to. Every packet when absent. */
    if?: AclMatch<V>;
    /** What happens to a matching packet. */
    then: "accept" | "drop";
    /** Accepted traffic above this rate is dropped. On RouterOS it did not limit traffic that the CPU routes. */
    rate?: Limit;
};

/** Spanning tree on every switched port. A port may override it. */
export type Stp = {
    /** Which version of spanning tree runs. When absent, RouterOS and Junos run RSTP, and VRP runs its own default, MSTP: Circuit writes no mode there. Raisecom ROS takes only `mstp`, and runs its own default when absent. */
    mode?: "stp" | "rstp" | "mstp";
    /** Bridge priority, 0 to 61440 in steps of 4096. The lowest becomes the root bridge. */
    priority?: number;
};

/** Layer 2 that the ports share. `V` is the device's VLAN names, `A` its ACL names, `I` its ports and interfaces. `Untrusted` is whether the network turns on `untrusted_vlans`. */
export type Switching<V extends string, A extends string, I extends string, Untrusted extends boolean = true> = {
    /** VLANs, keyed by name. Ports, LAGs, and VLAN interfaces use these names. */
    vlans?: Named<V, Vlan<Untrusted, NoInfer<V>>>;
    /**
     * VLAN IDs the device keeps for its own use, such as `{ min: 4000, max: 4063 }`. No VLAN of `switching.vlans` may be in the range. VRP routes a port only on a VLAN of this range, one VLAN for each routed port, so a routed port there needs it. A platform with no such setting refuses it.
     */
    reserved_vlans?: VlanRange;
    /** Spanning tree on every switched port. A port may override it. */
    stp?: Stp;
    /** DHCP snooping: a switched port drops DHCP servers' messages, such as offers, unless it has `dhcp_trusted`. So no host hands out IPv4 addresses. DHCPv6 is not covered. */
    dhcp_snooping?: true;
    /** Dynamic ARP inspection: a switched port drops an ARP packet unless DHCP snooping saw a DHCP server give its sender that MAC and IPv4 address, or the port has `dhcp_trusted`. So no host answers ARP for another's address. Needs `dhcp_snooping`. A host whose address is written by hand needs a port with `dhcp_trusted`. */
    arp_inspection?: true;
    /** RA guard (RFC 6105): a switched port drops IPv6 router advertisements unless it has `ra_trusted`. So no host poses as the gateway. */
    ra_guard?: true;
    /** Advertise and learn neighbors with LLDP on every port (`true`), or only on the interfaces listed. A port may override it. */
    lldp?:
        | true
        | {
              /** The ports and interfaces that run LLDP. */
              interfaces: readonly I[];
          };
    /** Hardware ACLs, keyed by name. A port uses one with `ingress_acl`. Each is a list of rules in order, written whole in one place. The first rule runs first. */
    acls?: Named<A, Ordered<AclRule<NoInfer<V>>>>;
};
