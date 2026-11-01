// Layer 2 shared by ports: `switching.vlans`, `.stp`, `.lldp`, `.acls`.

import type { Family, Named, OneOrMore, Ordered, Prefix, Rate } from "./common";
import type { Ports, Protocol } from "./firewall";

/**
 * A VLAN. Its key in `switching.vlans` is its name. `Untrusted` is whether the network turns on the check `untrusted_vlans`, which
 * `untrusted` needs.
 */
export type Vlan<Untrusted extends boolean = true> = {
    /** The VLAN's number on the wire, 1 to 4094. Two VLANs on a device never share one. */
    id: number;
    /** What the VLAN is for. Dropped on a platform where a VLAN is only its number (Raisecom, FortiOS), so a device takes a VLAN whole wherever it runs. */
    description?: string;
    /**
     * The VLAN carries traffic straight from outside: a transit, an exchange, an ISP handoff, or such a one's native VLAN. Only Circuit
     * reads it, for the check `untrusted_vlans`; the device never sees it. Write it on every device that declares the VLAN. Allowed only
     * when the network's `circuit()` turns on `untrusted_vlans`: an error in the editor, and `circuit check` stops.
     */
    untrusted?: Untrusted extends true ? true : "allowed only when circuit.ts turns on the check untrusted_vlans";
};

/**
 * Which packets an ACL rule applies to. All must be true.
 *
 * `vlan`, `src` and `dst` each take a list. Where the platform has no list, Circuit writes one rule per combination: the VLAN
 * outermost, then `src`, then `dst`.
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
    /** One of `switching.vlans`, or any of several: only packets in this VLAN. */
    vlan?: OneOrMore<V>;
};

/**
 * A stateless rule evaluated in hardware where traffic arrives, before routing, the condition first:
 * `{ if: { vlan: "ix", src: "10.0.0.0/8" }, then: "drop" }`. No `if`: every packet.
 */
export type AclRule<V extends string> = {
    /** Shown beside the rule on the device. */
    description?: string;
    /** Which packets the rule applies to. Every packet when absent. */
    if?: AclMatch<V>;
    /** What happens to a matching packet. */
    then: "accept" | "drop";
    /** Accepted traffic above this rate is dropped. On RouterOS it did not limit traffic the CPU routes; see its TRAPS.md. */
    rate?: Rate;
};

/** Spanning tree on every switched port. A port may override it. */
export type Stp = {
    /** Which variant runs. RSTP when absent. */
    mode?: "stp" | "rstp" | "mstp";
    /** Bridge priority, 0 to 61440 in steps of 4096. Lower wins the root election. */
    priority?: number;
};

/** Layer 2 that the ports share. `V` is the device's VLAN names, `A` its ACL names, `I` its ports and interfaces. `Untrusted` is whether the network turns on `untrusted_vlans`. */
export type Switching<V extends string, A extends string, I extends string, Untrusted extends boolean = true> = {
    /** VLANs, keyed by name. A port, a LAG or a VLAN interface names one of these. */
    vlans?: Named<V, Vlan<Untrusted>>;
    /** Spanning tree on every switched port. A port may override it. */
    stp?: Stp;
    /** Advertise and learn neighbors with LLDP on every port (`true`), or only on the interfaces listed. A port may override it. */
    lldp?:
        | true
        | {
              /** Some of the device's ports and interfaces. */
              interfaces: readonly I[];
          };
    /** Hardware ACLs, keyed by name, applied to a port with `ingress_acl`. Each is rules in order, written whole in one place: the first runs first. */
    acls?: Named<A, Ordered<AclRule<NoInfer<V>>>>;
};
