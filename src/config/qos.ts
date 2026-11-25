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

/** What a marking rule writes in a packet, and the class whose queue it takes: a DSCP, a PCP, a class, or several. */
export type Marking<C extends string = string> =
    | {
          /** The DSCP the packet leaves with. */
          dscp: Dscp;
          /** The PCP the packet leaves with, in the VLAN tag of the interface it leaves through. A packet that leaves without a tag carries none. */
          pcp?: Pcp;
          /** The class whose queue the packet takes as it leaves this device, from `qos.classes`, whatever DSCP it leaves with. The next device sorts it by its DSCP. */
          class?: C;
      }
    | {
          /** The DSCP the packet leaves with. */
          dscp?: Dscp;
          /** The PCP the packet leaves with, in the VLAN tag of the interface it leaves through. A packet that leaves without a tag carries none. */
          pcp: Pcp;
          /** The class whose queue the packet takes as it leaves this device, from `qos.classes`, whatever DSCP it leaves with. The next device sorts it by its DSCP. */
          class?: C;
      }
    | {
          /** The DSCP the packet leaves with. */
          dscp?: Dscp;
          /** The PCP the packet leaves with, in the VLAN tag of the interface it leaves through. A packet that leaves without a tag carries none. */
          pcp?: Pcp;
          /** The class whose queue the packet takes as it leaves this device, from `qos.classes`, whatever DSCP it leaves with. The next device sorts it by its DSCP. */
          class: C;
      };

/**
 * One marking rule, with the condition first: `{ if: { protocol: "udp", dst_port: 5060 }, then: { dscp: "cs5" } }`. Without `if`, it marks every packet the device routes.
 */
export type MarkingRule<I extends string, AS extends string, IS extends string, C extends string = string> = {
    /** Shown beside the rule on the device. */
    description?: string;
    /** Which packets the rule marks. Every packet the device routes when absent. */
    if?: MarkingMatch<I, AS, IS>;
    /** What a matching packet leaves with, and the class whose queue it takes. */
    then: Marking<C>;
};

/** A class of traffic: the packets that leave with one of its DSCPs, or that arrive with one of its PCPs. It lists one or both. */
export type QosClass =
    | {
          /** The DSCPs of its packets, such as `["af41", "af42", "af43"]` for video conferencing (RFC 4594). A DSCP is in one class at most. */
          dscp: readonly Dscp[];
          /** The PCPs of its packets, from the VLAN tag they arrive with (IEEE 802.1Q), such as `[5]` for calls from phones that set no DSCP. A packet that arrives without a tag has PCP 0, its port's default priority. A marking rule's `pcp` changes the PCP a packet leaves with, not its class. A PCP is in one class at most. */
          pcp?: readonly Pcp[];
      }
    | {
          /** The DSCPs of its packets, such as `["af41", "af42", "af43"]` for video conferencing (RFC 4594). A DSCP is in one class at most. */
          dscp?: readonly Dscp[];
          /** The PCPs of its packets, from the VLAN tag they arrive with (IEEE 802.1Q), such as `[5]` for calls from phones that set no DSCP. A packet that arrives without a tag has PCP 0, its port's default priority. A marking rule's `pcp` changes the PCP a packet leaves with, not its class. A PCP is in one class at most. */
          pcp: readonly Pcp[];
      };

/**
 * Random early detection, RED (RFC 2309, RFC 7567): the queue drops packets at random before it is full, by how full it is on average. A sender that slows down when it loses a packet slows down early, so the queue stays short. Every packet of the queue meets the same thresholds, whatever its drop precedence (RFC 2597).
 */
export type Red = {
    /** Below this fill, on average, no packet is dropped early, in percent of the queue's `depth_packets`. */
    min_threshold_percent: number;
    /** Above this fill, on average, every packet that comes is dropped, in percent of the queue's `depth_packets`, up to 100. Between the two thresholds, a packet is dropped at random, more often as the queue fills. */
    max_threshold_percent: number;
};

/** How many packets a queue holds, and how it drops what it has no room for. */
export type QueueManagement = {
    /** The most packets the queue holds. What comes while it is full is dropped: tail drop. The platform's own depth when absent, 10 packets on RouterOS. */
    depth_packets?: number;
    /** Drops packets at random before the queue is full, with RED. Needs `depth_packets`. Without it, the queue drops only what comes while it is full. */
    red?: Red;
};

/**
 * A queue sent before every weighted queue, such as for calls (RFC 3246) or the routers' own traffic (RFC 4594). Several strict queues take turns.
 *
 * RouterOS sends a strict queue first only up to its `max`, which it keeps for the queue even when the weighted queues are full. So there each strict queue needs `max`.
 */
export type StrictQueue<C extends string> = QueueManagement & {
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
export type WeightedQueue<C extends string> = QueueManagement & {
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
     *
     * FortiOS marks sessions, not packets: the rule that matches the first packet of a session marks every packet of it that goes the same way. The replies keep their DSCP.
     */
    marking?: Ordered<MarkingRule<I, AS, IS, NoInfer<C>>>;
    /**
     * Classes of traffic by name, each by its DSCPs (RFC 2475's behavior aggregates) or PCPs, such as `voice: { dscp: ["ef"], pcp: [5] }`. A packet takes the class a marking rule gives it, else the class that lists the DSCP it leaves with, after `marking`. Else it takes the class that lists the PCP it arrives with. `default_class` takes every other packet, so what it lists only shows what it holds. To sort packets by their address or port, mark their DSCP first in `marking`.
     *
     * FortiOS sorts sessions, not packets: the first packet of a session picks the class of every packet of it, both ways. The firewall's own traffic takes `default_class`.
     */
    classes?: Named<C, QosClass>;
    /** The class of every packet that no other class takes, from `qos.classes`. Needed with `classes`. */
    default_class?: NoInfer<C>;
    /** Ways to send what leaves an interface, by name. A port, LAG, or VLAN interface takes one with `scheduler`. */
    schedulers?: Named<S, Scheduler<NoInfer<C>>>;
};
