import type { Family, Named, OneOrMore, Ordered, Prefix, Rate } from "./common";
import type { Ports, Protocol } from "./firewall";

/**
 * A VLAN. Its key in `switching.vlans` is its name. `Untrusted` is whether the network turns on the check `untrusted_vlans`, which `untrusted` needs.
 */
export type Vlan<Untrusted extends boolean = true> = {
    /** The VLAN ID on the wire, 1 to 4094. Two VLANs on a device can't share an ID. */
    id: number;
    /** What the VLAN is for. On a platform where a VLAN is only its number (Raisecom, FortiOS), Circuit doesn't write it, so the same VLAN works on every platform. */
    description?: string;
    /**
     * The VLAN carries traffic straight from outside, such as a transit, an exchange, an ISP handoff, or the native VLAN of one of these. The check `untrusted_vlans` uses it, and the device never gets it. Write it on every device that declares the VLAN. Allowed only when the network's `circuit()` turns on `untrusted_vlans`. Otherwise the editor shows an error and `circuit validate` stops.
     */
    untrusted?: Untrusted extends true ? true : "allowed only when circuit.ts turns on the check untrusted_vlans";
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
    rate?: Rate;
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
    vlans?: Named<V, Vlan<Untrusted>>;
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
