import type { Named, OneOrMore, Ordered, Rate } from "./common";
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

/** A class of traffic: the packets that leave with one of its DSCPs. */
export type QosClass = {
    /** The DSCPs of its packets, such as `["af41", "af42", "af43"]` for video conferencing (RFC 4594). A DSCP is in one class at most. */
    dscp: readonly Dscp[];
};

/**
 * A queue sent before every weighted queue, such as for calls (RFC 3246) or the routers' own traffic (RFC 4594). Several strict queues take turns.
 *
 * RouterOS sends a strict queue first only up to its `max`, which it keeps for the queue even when the weighted queues are full. So there each strict queue needs `max`.
 */
export type StrictQueue<C extends string> = {
    /** The class it holds, from `qos.classes`. */
    class: C;
    /** `strict`: sent before the weighted queues. */
    priority: "strict";
    /** The most it sends, so it can't starve the weighted queues (RFC 3246, section 2.10). What comes faster is dropped. */
    max?: Rate;
    share?: never;
};

/**
 * A queue that shares what the strict queues leave with the other weighted queues.
 *
 * RouterOS keeps each weighted queue its share of the scheduler's rate less every strict queue's `max`. What a queue leaves unused, it lends to the weighted queues alike, not by share.
 */
export type WeightedQueue<C extends string> = {
    /** The class it holds, from `qos.classes`. */
    class: C;
    /** Its part of what the strict queues leave, in percent, 1 to 100. The shares of a scheduler add up to 100. */
    share: number;
    priority?: never;
    max?: never;
};

/** A queue of a scheduler: one class's packets, sent first or by its share. */
export type Queue<C extends string> = StrictQueue<C> | WeightedQueue<C>;

/** How an interface sends what leaves it: one queue for each class, and which goes first. An interface takes one with `scheduler`. */
export type Scheduler<C extends string> = {
    /** The rate of everything the interface sends, below its speed: the parent of its queues (hierarchical shaping). Packets wait in their queues only when more comes than the rate. RouterOS needs it. */
    rate?: Rate;
    /** One queue for each class of `qos.classes`, so no class is left out. A queue's place in the list changes nothing. */
    queues: readonly Queue<C>[];
};

/**
 * How the device treats traffic by its class. `I` is the device's ports and interfaces, `AS` its address sets, `IS` its interface sets, `C` its classes, and `S` its schedulers.
 */
export type Qos<I extends string, AS extends string, IS extends string, C extends string = string, S extends string = string> = {
    /**
     * Marks the packets the device routes, so the devices after it can tell their classes apart (RFC 2475). Rules in order: the first rule that matches marks the packet, and the rules after it are skipped. A packet that no rule matches keeps its DSCP. Packets the device sends or receives itself are not marked, nor packets it switches within a VLAN.
     */
    marking?: Ordered<MarkingRule<I, AS, IS>>;
    /**
     * Classes of traffic by name, each by its DSCPs (RFC 2475's behavior aggregates), such as `voice: { dscp: ["ef"] }`. A packet's class is the one that lists the DSCP it leaves with, after `marking`. To sort packets by their address or port, mark their DSCP first in `marking`.
     */
    classes?: Named<C, QosClass>;
    /** The class of every DSCP that no class lists, from `qos.classes`. Needed with `classes`. */
    default_class?: NoInfer<C>;
    /** Ways to send what leaves an interface, by name. A port, LAG, or VLAN interface takes one with `scheduler`. */
    schedulers?: Named<S, Scheduler<NoInfer<C>>>;
};
