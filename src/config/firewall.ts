import type { Family, HostAddress, IP, IPv4, Named, OneOrMore, Ordered, Prefix } from "./common";

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
 * Conditions on a packet. All must be true. A rule with addresses of one family applies to that family only. `I` is the device's ports and interfaces, `AS` its address sets, `IS` its interface sets.
 *
 * `src`, `dst`, `in_interface`, and `out_interface` each take a list, and an interface set stands for its interfaces. If the platform has no lists, Circuit writes one rule for each combination, in this order: interfaces first (`in` before `out`), then `src`, then `dst`. A `src` and a `dst` of different families match no packet, so Circuit leaves that combination out. If no combination is left, the rule is an error.
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
    /** The source is in this set, from `firewall.address_sets`. */
    src_address_set?: AS;
    /** The destination is in this set, from `firewall.address_sets`. */
    dst_address_set?: AS;
    /** Source port, or any of several. TCP and UDP only. */
    src_port?: Ports;
    /** Destination port, or any of several. TCP and UDP only. */
    dst_port?: Ports;
    /** The port or interface the packet arrived on, or any of several. */
    in_interface?: OneOrMore<I>;
    /** The port or interface the packet leaves through, or any of several. */
    out_interface?: OneOrMore<I>;
    /** The packet arrived on an interface of this set, from `firewall.interface_sets`. Not with `in_interface`. */
    in_interface_set?: IS;
    /** The packet leaves through an interface of this set, from `firewall.interface_sets`. Not with `out_interface`. */
    out_interface_set?: IS;
    /** The connection tracking state, any of these. */
    connection_state?: readonly ConnectionState[];
    /** How the connection was translated, any of these. `dstnat` is a connection whose destination was translated, such as to a port a host opened with UPnP. `srcnat` is one whose source was translated. Any connection when absent. */
    connection_nat_state?: readonly ("srcnat" | "dstnat")[];
    /** TCP flags that must be set, and flags that must not be. */
    tcp_flags?: {
        /** Flags that must be set. */
        set?: readonly TcpFlag[];
        /** Flags that must not be set. */
        unset?: readonly TcpFlag[];
    };
};

/**
 * One firewall rule, with the condition first: `{ if: { protocol: "icmp" }, then: "accept" }`. Without `if`, it applies to every packet.
 */
export type FilterRule<I extends string, AS extends string, IS extends string> = {
    /** Shown beside the rule on the device. */
    description?: string;
    /** Which packets the rule applies to. Every packet when absent. */
    if?: FilterMatch<I, AS, IS>;
    /** What happens to a matching packet. `reject` answers the sender, `drop` does not. */
    then: "accept" | "drop" | "reject";
    /** Send the rest of an accepted flow through the fast path, so it skips the remaining rules. */
    fast_path?: true;
};

/** Rules in order. The first rule that matches decides. A packet that no rule matches gets `default_action`. */
export type Chain<I extends string, AS extends string, IS extends string> = {
    /** What happens to a packet no rule matched. Accept when absent. */
    default_action?: "accept" | "drop";
    /** Rules in order. The first rule runs first. Write the list whole, in one place, and use `merge` to place rules from other files in it. */
    rules?: Ordered<FilterRule<I, AS, IS>>;
};

/**
 * One address translation, with the condition first: `{ if: { src: "10.0.0.0/24", out_interface_set: "uplinks" }, then: "snat", to_address: "192.0.2.1" }`. Without `if`, it applies to every packet.
 */
export type NatRule<I extends string, AS extends string, IS extends string> = {
    /** Shown beside the rule on the device. */
    description?: string;
    /** Which packets are translated. Every packet when absent. */
    if?: FilterMatch<I, AS, IS>;
} & (
    | {
          /** `masquerade` rewrites the source to the address of the outgoing interface. */
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
    | {
          /** `snat` to a pool shares IPv4 addresses among subscribers, as carrier-grade NAT does. Source NAT only. */
          then: "snat";
          /** The IPv4 addresses the subscribers in `if.src` leave as. Each subscriber leaves as one pool address, with blocks of TCP and UDP ports of its own. */
          to_pool: `${IPv4}/${number}`;
          /**
           * `deterministic`: each subscriber of `if.src`, one IPv4 prefix, always leaves as the same pool address with the same block of ports (RFC 7422). Each pool address takes the same number of subscribers: a /22 on a /27 is 32 on each. The blocks go in address order from port 1024. Other protocols, such as ICMP, leave as the same address. `circuit nat lookup` finds the subscriber.
           */
          port_allocation: "deterministic";
          /** The ports in each subscriber's block. The subscribers on one pool address times this must fit in the ports from 1024 to 65535: 32 subscribers take 2016 ports each at most. */
          port_set_size: number;
          port_sets_per_subscriber?: never;
          port_set_timeout?: never;
      }
    | {
          /**
           * `nat64` translates IPv6 packets to IPv4 (RFC 6146), so hosts with IPv6 alone reach IPv4 servers. `if.dst` is the NAT64 prefix, such as the well-known `64:ff9b::/96`. A packet to an address in it goes to the IPv4 address embedded there (RFC 6052), the last 32 bits after a /96, and leaves from `to_address`. Source NAT only. `services.dns64` gives hosts these addresses.
           */
          then: "nat64";
          /** The IPv4 address translated packets leave from. Every host shares its ports. */
          to_address: IPv4;
      }
    | {
          /** `snat` to a pool shares IPv4 addresses among subscribers, as carrier-grade NAT does. `nat64` does the same for the IPv6 subscribers it translates (RFC 6146's IPv4 address pool). Source NAT only. */
          then: "snat" | "nat64";
          /** The IPv4 addresses the subscribers in `if.src` leave as. Each subscriber leaves as one pool address, with blocks of TCP and UDP ports of its own. */
          to_pool: `${IPv4}/${number}`;
          /**
           * `dynamic`: the device gives a subscriber a block of ports when it needs one (RFC 8512's port range allocation). It takes the block back `port_set_timeout` seconds after the block's last connection ends. It logs each block it gives and takes back, with the subscriber, pool address, and ports. Only that log finds the subscriber behind an address and port, so send it to a `monitoring.syslog` collector.
           */
          port_allocation: "dynamic";
          /** The ports in each block. */
          port_set_size: number;
          /** The most blocks one subscriber holds at once. Its port limit (RFC 6888, REQ-4) is this times `port_set_size`. */
          port_sets_per_subscriber: number;
          /** Seconds a subscriber keeps a block that no connection uses, RFC 8512's `port-set-timeout`. Its next connections leave from the same address and ports, with no new log line. The device's own time when absent. */
          port_set_timeout?: number;
      }
);

/**
 * One TCP MSS clamp, with the condition first: `{ if: { out_interface: "tunnel-01" }, mss: "path_mtu" }`. It rewrites the maximum segment size in each TCP SYN the device routes, so the connection's packets fit a link with a smaller MTU on the path. Without `if`, it applies to every routed SYN.
 */
export type TcpMssRule<I extends string, AS extends string, IS extends string> = {
    /** Shown beside the rule on the device. */
    description?: string;
    /** Which routed SYNs are rewritten. Every routed SYN when absent. */
    if?: Omit<FilterMatch<I, AS, IS>, "protocol" | "tcp_flags" | "connection_state">;
    /** The MSS to write, in bytes, if the SYN offers more. Or `path_mtu`, which is the MTU of the interface the SYN leaves through, minus the IP and TCP headers. */
    mss: number | "path_mtu";
};

/** Connection-tracking helpers, which rewrite application payloads. Only the ones you list run. */
export type Helper = "ftp" | "tftp" | "sip" | "h323" | "pptp" | "rtsp" | "irc";

/** What the device filters and translates. `AS` is the device's address set names, `I` its ports and interfaces, `IS` its interface set names. */
export type Firewall<AS extends string, I extends string, IS extends string> = {
    /** Named groups of addresses and prefixes, of either family. Rules match on them with `src_address_set` and `dst_address_set`. */
    address_sets?: Named<AS, readonly (IP | Prefix)[]>;
    /**
     * Named groups of the device's ports and interfaces, like a RouterOS interface list or a FortiOS zone. Rules match on them with `in_interface_set` and `out_interface_set`. Each set is a plain list, so each part can add to it, such as each upstream adding its interface to `uplinks`.
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
    /** Source translation on the way out, and destination translation on the way in. Each is a list of rules in order. The first rule runs first. */
    nat?: {
        /** Rewrites the source of traffic on the way out. */
        source?: Ordered<NatRule<I, NoInfer<AS>, NoInfer<IS>>>;
        /** Rewrites the destination of traffic on the way in. */
        destination?: Ordered<NatRule<I, NoInfer<AS>, NoInfer<IS>>>;
    };
    /** TCP MSS clamps on routed SYNs, of both families. It is a plain list, not an ordered chain, so each part can add its own, such as one for each tunnel. None when absent. */
    tcp_mss?: readonly TcpMssRule<I, NoInfer<AS>, NoInfer<IS>>[];
    /** Connection-tracking helpers that run. None when absent. */
    conntrack_helpers?: readonly Helper[];
    /**
     * Traffic to and from these prefixes passes without connection tracking. A flood toward them can't fill the connection table, and rules see their packets in the state `untracked`. Everything is tracked when absent.
     *
     * An address in these prefixes that NAT uses stays tracked: a source translation's `to_address`, or a destination translation's `to_address` or matched `dst`. Circuit writes two accept rules for each such address, for traffic to it and from it, before the untracked rules. Without them, a reply to that address would skip tracking and never be translated back.
     */
    untracked?: readonly Prefix[];
};
