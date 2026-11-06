// Which packets pass and how they are rewritten: `firewall.address_sets`, `.interface_sets`, `.filter`, `.nat`, `.untracked`, `.conntrack_helpers`.

import type { Family, HostAddress, IP, Named, OneOrMore, Ordered, Prefix } from "./common";

/** An IP protocol. `icmp` means ICMPv6 in an IPv6 rule. */
export type Protocol = "tcp" | "udp" | "icmp" | "gre" | "esp" | "ah" | "ospf" | "vrrp";

/** The state connection tracking gives a packet. */
export type ConnectionState = "new" | "established" | "related" | "untracked" | "invalid";

/** Ports from `min` to `max`, both included. */
export type PortRange = {
    /** The first port, 0 to 65535. */
    min: number;
    /** The last port, 0 to 65535, not below `min`. */
    max: number;
};

/** A port, a range of ports, or any of several. */
export type Ports = number | PortRange | readonly (number | PortRange)[];

/** A TCP header flag. */
export type TcpFlag = "fin" | "syn" | "rst" | "psh" | "ack" | "urg";

/**
 * Conditions on a packet. All must be true. A rule with addresses of one family applies to that family only. `I` is the device's
 * ports and interfaces, `AS` its address sets, `IS` its interface sets.
 *
 * `src`, `dst`, `in_interface` and `out_interface` each take a list, and an interface set stands for its interfaces. Where the
 * platform has no list, Circuit writes one rule per combination: the interface outermost (`in` before `out`), then `src`, then `dst`.
 */
export type FilterMatch<I extends string, AS extends string, IS extends string> = {
    /** Only packets of this family. */
    family?: Family;
    /** IP protocol. */
    protocol?: Protocol;
    /** Source address or prefix, or any of several. */
    src?: OneOrMore<Prefix>;
    /** Destination address or prefix, or any of several. */
    dst?: OneOrMore<Prefix>;
    /** One of `firewall.address_sets`: the source is in it. */
    src_address_set?: AS;
    /** One of `firewall.address_sets`: the destination is in it. */
    dst_address_set?: AS;
    /** Source port, or any of several. TCP and UDP only. */
    src_port?: Ports;
    /** Destination port, or any of several. TCP and UDP only. */
    dst_port?: Ports;
    /** One of the device's ports or interfaces, or any of several: the packet arrived on it. */
    in_interface?: OneOrMore<I>;
    /** One of the device's ports or interfaces, or any of several: the packet leaves through it. */
    out_interface?: OneOrMore<I>;
    /** One of `firewall.interface_sets`: the packet arrived on one of its interfaces. Not with `in_interface`. */
    in_interface_set?: IS;
    /** One of `firewall.interface_sets`: the packet leaves through one of its interfaces. Not with `out_interface`. */
    out_interface_set?: IS;
    /** Connection tracking state, any of these. */
    connection_state?: readonly ConnectionState[];
    /** TCP flags that must be set, and flags that must not be. */
    tcp_flags?: {
        /** Flags that must be set. */
        set?: readonly TcpFlag[];
        /** Flags that must not be set. */
        unset?: readonly TcpFlag[];
    };
};

/**
 * One firewall rule, the condition first: `{ if: { protocol: "icmp" }, then: "accept" }`. No `if`: every packet.
 */
export type FilterRule<I extends string, AS extends string, IS extends string> = {
    /** Shown beside the rule on the device. */
    description?: string;
    /** Which packets the rule applies to. Every packet when absent. */
    if?: FilterMatch<I, AS, IS>;
    /** What happens to a matching packet. `reject` answers the sender, `drop` does not. */
    then: "accept" | "drop" | "reject";
    /** Send the rest of an accepted flow through the fast path, skipping the remaining rules. */
    fast_path?: true;
};

/** Rules in order, the first match wins, then `default_action`. */
export type Chain<I extends string, AS extends string, IS extends string> = {
    /** What happens to a packet no rule matched. Accept when absent. */
    default_action?: "accept" | "drop";
    /** Rules in order: the first runs first. Written whole in one place; `merge` places rules from other files in it. */
    rules?: Ordered<FilterRule<I, AS, IS>>;
};

/**
 * One address translation, the condition first: `{ if: { src: "10.0.0.0/24", out_interface_set: "uplinks" }, then: "snat", to_address: "192.0.2.1" }`.
 * No `if`: every packet.
 */
export type NatRule<I extends string, AS extends string, IS extends string> = {
    /** Shown beside the rule on the device. */
    description?: string;
    /** Which packets are translated. Every packet when absent. */
    if?: FilterMatch<I, AS, IS>;
} & (
    | {
          /** `masquerade` uses the address of the outgoing interface. */
          then: "masquerade";
      }
    | {
          /** `snat` rewrites the source, `dnat` the destination. */
          then: "snat" | "dnat";
          /** The address to rewrite to, alone or with its length. */
          to_address: HostAddress;
          /** The port to rewrite to. Unchanged when absent. */
          to_port?: number;
      }
);

/**
 * One TCP MSS clamp, the condition first: `{ if: { out_interface: "tunnel-01" }, mss: "path_mtu" }`. It rewrites the maximum segment size in a TCP SYN the device routes, so the connection's packets fit a link with a smaller MTU on the way. No `if`: every routed SYN.
 */
export type TcpMssRule<I extends string, AS extends string, IS extends string> = {
    /** Shown beside the rule on the device. */
    description?: string;
    /** Which SYNs are rewritten, besides being TCP SYNs. Every routed SYN when absent. */
    if?: Omit<FilterMatch<I, AS, IS>, "protocol" | "tcp_flags" | "connection_state">;
    /** The MSS written, in bytes, when the SYN offers more; or `path_mtu`: the MTU of the interface the SYN leaves through, less the IP and TCP headers. */
    mss: number | "path_mtu";
};

/** Connection-tracking helpers that rewrite application payloads. None run unless listed. */
export type Helper = "ftp" | "tftp" | "sip" | "h323" | "pptp" | "rtsp" | "irc";

/** What the device filters and translates. `AS` is the device's address set names, `I` its ports and interfaces, `IS` its interface set names. */
export type Firewall<AS extends string, I extends string, IS extends string> = {
    /** Named groups of addresses and prefixes, of either family, that rules match on with `src_address_set` and `dst_address_set`. */
    address_sets?: Named<AS, readonly (IP | Prefix)[]>;
    /**
     * Named groups of the device's ports and interfaces, that rules match on with `in_interface_set` and `out_interface_set`, like a
     * RouterOS interface list or a FortiOS zone. A list: each part adds its own, such as each upstream its interface to `uplinks`.
     */
    interface_sets?: Named<IS, readonly I[]>;
    /** Traffic to the device (`input`), through it (`forward`), and from it (`output`). */
    filter?: {
        /** Traffic to the device itself. */
        input?: Chain<I, NoInfer<AS>, NoInfer<IS>>;
        /** Traffic the device routes. */
        forward?: Chain<I, NoInfer<AS>, NoInfer<IS>>;
        /** Traffic the device itself sends. */
        output?: Chain<I, NoInfer<AS>, NoInfer<IS>>;
    };
    /** Source translation on the way out, destination translation on the way in. Each is rules in order: the first runs first. */
    nat?: {
        /** Rewrites the source of traffic on the way out. */
        source?: Ordered<NatRule<I, NoInfer<AS>, NoInfer<IS>>>;
        /** Rewrites the destination of traffic on the way in. */
        destination?: Ordered<NatRule<I, NoInfer<AS>, NoInfer<IS>>>;
    };
    /** TCP MSS clamps on routed SYNs, of both families. A list, not an ordered chain: each part adds its own, such as each tunnel's. None when absent. */
    tcp_mss?: readonly TcpMssRule<I, NoInfer<AS>, NoInfer<IS>>[];
    /** Connection-tracking helpers that run. None when absent. */
    conntrack_helpers?: readonly Helper[];
    /**
     * Traffic to and from these prefixes passes without connection tracking. A flood toward them cannot fill the connection table, and rules see its packets in the state `untracked`. Everything is tracked when absent.
     *
     * Each address NAT uses inside one of these prefixes (a source translation's `to_address`, a destination translation's `to_address` or matched `dst`) stays tracked: Circuit writes two accept rules for it, one for traffic to it and one for traffic from it, before the untracked rules. Without them, a reply to that address would skip tracking and never be translated back.
     */
    untracked?: readonly Prefix[];
};
