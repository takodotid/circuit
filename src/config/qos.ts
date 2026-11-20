import type { OneOrMore, Ordered } from "./common";
import type { FilterMatch } from "./firewall";

/**
 * A DSCP (RFC 2474), by its name in the IANA DSCP registry. The class selectors are `cs0` to `cs7` (RFC 2474), and assured forwarding `af11` to `af43` (RFC 2597). Expedited forwarding is `ef` (RFC 3246), with `voice-admit` (RFC 5865). Lower effort is `le` (RFC 8622), and non-queue-building `nqb` (RFC 9956). `cs0` is best effort, the DSCP of unmarked traffic. RFC 4594 gives each service class its DSCP, such as `ef` for telephony, `af41` for video conferencing, and `cs6` for routing protocols.
 */
export type Dscp =
    | "cs0"
    | "cs1"
    | "cs2"
    | "cs3"
    | "cs4"
    | "cs5"
    | "cs6"
    | "cs7"
    | "af11"
    | "af12"
    | "af13"
    | "af21"
    | "af22"
    | "af23"
    | "af31"
    | "af32"
    | "af33"
    | "af41"
    | "af42"
    | "af43"
    | "ef"
    | "voice-admit"
    | "le"
    | "nqb";

/** An IEEE 802.1Q priority, the PCP a VLAN tag carries, 0 to 7. 0 is best effort, 1 is background, below it, and 2 to 7 are above it: 5 for voice, 6 and 7 for network control. */
export type Pcp = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

/**
 * Conditions on a packet: a firewall rule's, without the connection's state or TCP flags, as every packet of a flow is marked alike. And the DSCP it arrives with. All must be true. A list in `dscp` makes one rule for each value, after `src` and `dst`.
 */
export type MarkingMatch<I extends string, AS extends string, IS extends string> = Omit<
    FilterMatch<I, AS, IS>,
    "connection_state" | "connection_nat_state" | "tcp_flags"
> & {
    /** The DSCP the packet arrives with, or any of several. */
    dscp?: OneOrMore<Dscp>;
};

/** What a marking rule writes in a packet: a DSCP, a PCP, or both. */
export type Marking =
    | {
          /** The DSCP the packet leaves with. */
          dscp: Dscp;
          /** The PCP the packet leaves with, in the VLAN tag of the interface it leaves through. A packet that leaves without a tag carries none. */
          pcp?: Pcp;
      }
    | {
          /** The DSCP the packet leaves with. */
          dscp?: Dscp;
          /** The PCP the packet leaves with, in the VLAN tag of the interface it leaves through. A packet that leaves without a tag carries none. */
          pcp: Pcp;
      };

/**
 * One marking rule, with the condition first: `{ if: { protocol: "udp", dst_port: 5060 }, then: { dscp: "cs5" } }`. Without `if`, it marks every packet the device routes.
 */
export type MarkingRule<I extends string, AS extends string, IS extends string> = {
    /** Shown beside the rule on the device. */
    description?: string;
    /** Which packets the rule marks. Every packet the device routes when absent. */
    if?: MarkingMatch<I, AS, IS>;
    /** What a matching packet leaves with. */
    then: Marking;
};

/** How the device treats traffic by its class. `I` is the device's ports and interfaces, `AS` its address sets, `IS` its interface sets. */
export type Qos<I extends string, AS extends string, IS extends string> = {
    /**
     * Marks the packets the device routes, so the devices after it can tell their classes apart (RFC 2475). Rules in order: the first rule that matches marks the packet, and the rules after it are skipped. A packet that no rule matches keeps its DSCP. Packets the device sends or receives itself are not marked, nor packets it switches within a VLAN.
     */
    marking?: Ordered<MarkingRule<I, AS, IS>>;
};
