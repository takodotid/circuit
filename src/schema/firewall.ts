import type { Family, IP, Prefix, Rate } from "./common";

/** An IP protocol. `icmp` means ICMPv6 in an IPv6 rule. */
export type Protocol = "tcp" | "udp" | "icmp" | "gre" | "esp" | "ah" | "ospf" | "vrrp";

/** The state connection tracking assigns a packet. */
export type ConnectionState = "new" | "established" | "related" | "untracked" | "invalid";

/** A TCP header flag. */
export type TcpFlag = "fin" | "syn" | "rst" | "psh" | "ack" | "urg";

/** Conditions on a packet. All must hold. A rule with addresses of one family applies to that family only. */
export type FilterMatch<I extends string, AS extends string> = {
    /** Only packets of this family. */
    family?: Family;
    /** IP protocol. */
    protocol?: Protocol;
    /** Source address or prefix. */
    src?: Prefix;
    /** Destination address or prefix. */
    dst?: Prefix;
    /** Source is in this address set. */
    src_set?: AS;
    /** Destination is in this address set. */
    dst_set?: AS;
    /** Source port, or any of several. TCP and UDP only. */
    src_port?: number | readonly number[];
    /** Destination port, or any of several. TCP and UDP only. */
    dst_port?: number | readonly number[];
    /** Arrived on this interface. */
    in_interface?: I;
    /** Leaves through this interface. */
    out_interface?: I;
    /** Connection tracking state, any of these. */
    state?: readonly ConnectionState[];
    /** TCP flags that must be set, and flags that must not be. */
    tcp_flags?: { set?: readonly TcpFlag[]; unset?: readonly TcpFlag[] };
};

/** One firewall rule. */
export type FilterRule<I extends string, AS extends string> = {
    /** Shown beside the rule on the device. */
    description?: string;
    /** Which packets the rule applies to. Every packet when absent. */
    match?: FilterMatch<I, AS>;
    /** What happens to a matching packet. `reject` answers the sender, `drop` does not. */
    action: "accept" | "drop" | "reject";
    /** Hand the rest of an accepted flow to the fast path, past the remaining rules. */
    offload?: true;
};

/** Rules evaluated in order, first match wins, then `default`. */
export type Chain<I extends string, AS extends string> = {
    /** What happens to a packet no rule matched. Accept when absent. */
    default?: "accept" | "drop";
    /** Evaluated in order. */
    rules?: readonly FilterRule<I, AS>[];
};

/** One address translation. */
export type NatRule<I extends string, AS extends string> = {
    /** Shown beside the rule on the device. */
    description?: string;
    /** Which packets are translated. Every packet when absent. */
    match?: FilterMatch<I, AS>;
} & (
    | {
          /** Use the address of the outgoing interface. */
          action: "masquerade";
      }
    | {
          /** `snat` rewrites the source, `dnat` the destination. */
          action: "snat" | "dnat";
          /** The address to rewrite to. */
          to: IP;
          /** The port to rewrite to. Unchanged when absent. */
          to_port?: number;
      }
);

/** Connection-tracking helpers that rewrite application payloads. None run unless listed. */
export type Helper = "ftp" | "tftp" | "sip" | "h323" | "pptp" | "rtsp" | "irc";

/** What the device filters and translates. */
export type Firewall<I extends string, AS extends string> = {
    /** Named groups of addresses and prefixes, of either family, that rules match on. */
    address_sets?: Record<AS, readonly (IP | Prefix)[]>;
    /** Traffic to the device, through it, and from it. */
    filter?: {
        input?: Chain<I, NoInfer<AS>>;
        forward?: Chain<I, NoInfer<AS>>;
        output?: Chain<I, NoInfer<AS>>;
    };
    /** Source translation on the way out, destination translation on the way in. */
    nat?: {
        source?: readonly NatRule<I, NoInfer<AS>>[];
        destination?: readonly NatRule<I, NoInfer<AS>>[];
    };
    /** Helpers that run. None when absent. */
    helpers?: readonly Helper[];
};

/** A stateless rule evaluated in hardware where traffic arrives, before routing. */
export type AclRule<V extends string> = {
    /** Shown beside the rule on the device. */
    description?: string;
    /** Which packets the rule applies to. Every packet when absent. */
    match?: {
        /** Only packets of this family. */
        family?: Family;
        /** IP protocol. */
        protocol?: Protocol;
        /** Source prefix. */
        src?: Prefix;
        /** Destination prefix. */
        dst?: Prefix;
        /** Source port, or any of several. */
        src_port?: number | readonly number[];
        /** Destination port, or any of several. */
        dst_port?: number | readonly number[];
        /** Carried in this VLAN. */
        vlan?: V;
    };
    /** What happens to a matching packet. */
    action: "accept" | "drop";
    /** Accepted traffic above this rate is dropped. On RouterOS it did not limit traffic the CPU routes; see its TRAPS.md. */
    rate?: Rate;
};
