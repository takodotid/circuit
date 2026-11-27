import { Derive } from "../../core/derive";
import type { Device, Finding, Lag, Port, QosTrust } from "../../model";
import type { JunosNames } from "./names";
import { JunosStatements } from "./statements";

/** A port or a LAG where packets arrive, as class-of-service names it, whether its frames arrive without a VLAN tag, and what it trusts. */
type Arrival = { physical: string; routed: boolean; untagged: boolean; trust: readonly QosTrust[] };

/**
 * Classes and schedulers on a QFX5100: a forwarding class for each class, and classifiers on every port and LAG where packets arrive. Each scheduler is a scheduler map on each port and LAG that takes it. The switch classifies a packet as it arrives, so a class lists every DSCP or PCP it holds, the default class the rest.
 */
export class JunosQos {
    /** A QFX5100 has 8 queues for unicast, 0 to 7 (Juniper's CoS support by platform). */
    static readonly QUEUES = 8;

    /** Every DSCP, 0 to 63 (RFC 2474). A classifier lists each, so none falls to a forwarding class the switch keeps for itself. */
    private static readonly DSCPS = 64;

    /** Every PCP, 0 to 7 (IEEE 802.1Q). */
    private static readonly PCPS = 8;

    /** A DSCP is 6 bits and a PCP 3, as a classifier's code points write them. */
    private static readonly DSCP_BITS = 6;
    private static readonly PCP_BITS = 3;

    /** The DSCP classifier and the IEEE 802.1p one. Each type has its own names. */
    static readonly CLASSIFIER = "circuit";

    /** The classifiers of a port that trusts neither, each with every code point in the default class. Without a classifier of its own, a QFX5100 port takes a default one, which trusts the DSCP or the PCP (Juniper's QFX default classifiers). */
    static readonly UNTRUSTED = "circuit-untrusted";

    /** Classes have no drop precedence, so every packet takes the lowest loss priority, which a forwarding class needs beside it. */
    static readonly LOSS_PRIORITY = "low";

    /** A class's queue: its place in `qos.classes`. */
    static queues(device: Device): Map<string, number> {
        return new Map(Object.keys(device.qos?.classes ?? {}).map((name, queue) => [name, queue]));
    }

    /** Whether the classes sort packets by the PCP they arrive with, rather than by their DSCP. `unsupported()` refuses both. */
    static byPcp(device: Device): boolean {
        const fallback = device.qos?.default_class;
        return Object.entries(device.qos?.classes ?? {}).some(([name, settings]) => name !== fallback && settings?.pcp?.length);
    }

    /** The class a marking rule gives by the DSCP it writes: the class that lists it. Else, by DSCP, the default class. By PCP, the class the port gave stays. */
    static classOfWritten(device: Device, value: number): string | undefined {
        const listing = Object.entries(device.qos?.classes ?? {}).find(([, settings]) =>
            (settings?.dscp ?? []).some((dscp) => Derive.DSCP[dscp] === value)
        );
        if (listing) return listing[0];
        return JunosQos.byPcp(device) ? undefined : device.qos?.default_class;
    }

    static render(out: JunosStatements, device: Device, names: JunosNames): void {
        const fallback = device.qos?.default_class;
        if (!fallback) return;

        for (const [name, queue] of JunosQos.queues(device)) out.set(`class-of-service forwarding-classes class ${name} queue-num`, queue);

        // By PCP, an IP packet that arrives without a tag has PCP 0, so its class is PCP 0's, whatever its DSCP.
        const byPcp = JunosQos.byPcp(device);
        const untaggedClass = JunosQos.owner(device, "pcp", 0);
        for (let value = 0; value < JunosQos.DSCPS; value++) {
            const name = byPcp ? untaggedClass : JunosQos.owner(device, "dscp", value);
            JunosQos.code(out, "dscp", name, value.toString(2).padStart(JunosQos.DSCP_BITS, "0"));
        }
        // By DSCP, what is not IP has no DSCP, and takes the default class.
        for (let value = 0; value < JunosQos.PCPS; value++) {
            const name = byPcp ? JunosQos.owner(device, "pcp", value) : fallback;
            JunosQos.code(out, "ieee-802.1", name, value.toString(2).padStart(JunosQos.PCP_BITS, "0"));
        }

        // A classifier sits on a switched port's unit 0, and on a routed port itself (Juniper's CoS support by platform). With both, IP takes the DSCP one.
        const arrivals = JunosQos.arrivals(device, names);
        let untrusting = false;
        for (const { physical, routed, untagged, trust } of arrivals) {
            const at = routed ? `class-of-service interfaces ${physical}` : `class-of-service interfaces ${physical} unit 0`;
            if (!trust.includes(byPcp ? "pcp" : "dscp")) {
                out.set(at, "classifiers dscp", JunosQos.UNTRUSTED);
                out.set(at, "classifiers ieee-802.1", JunosQos.UNTRUSTED);
                untrusting = true;
                continue;
            }
            if (!byPcp || untagged) out.set(at, "classifiers dscp", JunosQos.CLASSIFIER);
            out.set(at, "classifiers ieee-802.1", JunosQos.CLASSIFIER);
        }

        if (untrusting) {
            for (let value = 0; value < JunosQos.DSCPS; value++)
                JunosQos.code(out, "dscp", fallback, value.toString(2).padStart(JunosQos.DSCP_BITS, "0"), JunosQos.UNTRUSTED);
            for (let value = 0; value < JunosQos.PCPS; value++)
                JunosQos.code(out, "ieee-802.1", fallback, value.toString(2).padStart(JunosQos.PCP_BITS, "0"), JunosQos.UNTRUSTED);
        }

        JunosQos.schedulers(out, device, names);
    }

    /** One scheduler for each queue, named after the scheduler and its class, in a scheduler map of the scheduler's name on each port and LAG that takes it. A weighted queue's share is its transmit rate, which also weighs how the queues share what is left. */
    private static schedulers(out: JunosStatements, device: Device, names: JunosNames): void {
        const used = new Set(Derive.scheduled(device).map(({ scheduler }) => scheduler));

        for (const [name, scheduler] of Object.entries(device.qos?.schedulers ?? {})) {
            if (!scheduler || !used.has(name)) continue;

            for (const queue of scheduler.queues) {
                const each = `class-of-service schedulers ${name}-${queue.class}`;
                if (queue.priority === "strict") {
                    out.set(each, "priority strict-high");
                    if (queue.max) out.set(each, "shaping-rate", JunosStatements.amount(Derive.bitsPerSecond(queue.max)));
                } else out.set(each, "transmit-rate percent", queue.share);
                out.set(`class-of-service scheduler-maps ${name} forwarding-class ${queue.class} scheduler ${name}-${queue.class}`);
            }
        }

        for (const { kind, name, scheduler } of Derive.scheduled(device))
            if (kind !== "vlan_interface") out.set(`class-of-service interfaces ${names.physical(name)} scheduler-map`, scheduler);
    }

    /** One code point of a classifier. */
    private static code(
        out: JunosStatements,
        type: "dscp" | "ieee-802.1",
        name: string,
        bits: string,
        classifier = JunosQos.CLASSIFIER
    ): void {
        out.set(
            `class-of-service classifiers ${type} ${classifier} forwarding-class ${name} loss-priority ${JunosQos.LOSS_PRIORITY} code-points`,
            bits
        );
    }

    /** The class that lists this DSCP or PCP, other than the default class, else the default class. */
    private static owner(device: Device, field: "dscp" | "pcp", value: number): string {
        const fallback = device.qos!.default_class!;
        const listing = Object.entries(device.qos?.classes ?? {}).find(
            ([name, settings]) =>
                name !== fallback &&
                (field === "dscp"
                    ? (settings?.dscp ?? []).some((dscp) => Derive.DSCP[dscp] === value)
                    : (settings?.pcp ?? []).some((pcp) => pcp === value))
        );
        return listing?.[0] ?? fallback;
    }

    /** Each port and LAG where packets arrive: switched, or routed with an address. A port in a LAG arrives through the LAG, and a management port forwards nothing. */
    static arrivals(device: Device, names: JunosNames): Arrival[] {
        const holders: [string, Port | Lag][] = [
            ...Derive.ports(device).filter(([name, port]) => !port.in_lag && !names.port(name).startsWith("em")),
            ...Object.entries(device.interfaces?.lag ?? {}).flatMap(([name, lag]): [string, Lag][] => (lag ? [[name, lag]] : [])),
        ];

        return holders.flatMap(([name, settings]) => {
            const switched = !!(settings.access_vlan || settings.trunk_vlans || settings.qinq_vlan);
            if (!switched && !settings.addresses?.length) return [];
            const untagged = !switched || !!settings.access_vlan;
            return [{ physical: names.physical(name), routed: !switched, untagged, trust: settings.qos_trust ?? [] }];
        });
    }

    /** What the switch can't do as the classes and schedulers mean it. */
    static unsupported(device: Device): string[] {
        const found: string[] = [];
        const qos = device.qos;
        const fallback = qos?.default_class;

        const count = Object.keys(qos?.classes ?? {}).length;
        if (count > JunosQos.QUEUES)
            found.push(`qos.classes, ${count} of them: a QFX5100 has ${JunosQos.QUEUES} queues for unicast, one for each class`);

        const others = Object.entries(qos?.classes ?? {}).filter(([name]) => name !== fallback);
        if (others.some(([, settings]) => settings?.dscp?.length) && others.some(([, settings]) => settings?.pcp?.length))
            found.push(
                "qos.classes by DSCP and by PCP: a QFX5100 sorts an IP packet by its DSCP alone once a port has a DSCP classifier, so a DSCP that no class lists can't fall back to the PCP. Sort by one of them"
            );
        if (fallback && Derive.switchedHolders(device).some(({ settings }) => settings.qinq_vlan))
            found.push(
                "qos.classes beside a QinQ VLAN, whose frames arrive on units the switch doesn't classify: it classifies unit 0 only"
            );

        for (const [name, scheduler] of Object.entries(qos?.schedulers ?? {})) {
            if (!scheduler) continue;
            const where = `qos.schedulers.${name}`;
            if (scheduler.rate !== undefined)
                found.push(
                    `${where}.rate, which a QFX5100 can't keep: Junos ignores a port's shaping-rate there. Leave rate out, and the queues share the port's speed`
                );
            if (scheduler.queues.filter((queue) => queue.priority === "strict").length > 1)
                found.push(
                    `${where}.queues, several strict queues, which Juniper doesn't document as taking turns on a QFX5100. On a QFX5200 the higher queue goes first. Write one strict queue`
                );
            scheduler.queues.forEach((queue, index) => {
                if (queue.depth_packets !== undefined)
                    found.push(
                        `${where}.queues[${index}].depth_packets, which a QFX5100 can't set: it gives a queue a part of its port's buffer, in percent of the bytes, not a number of packets`
                    );
                if (queue.red)
                    found.push(
                        `${where}.queues[${index}].red, which a QFX5100 can't set: its RED counts in percent of the queue's buffer, which is no number of packets`
                    );
            });
        }

        // Juniper's QFX page on applying classifiers: an IRB interface takes none, its VLAN's ports do.
        for (const { where, kind } of Derive.trusting(device))
            if (kind === "vlan_interface")
                found.push(
                    `${where}.qos_trust on a VLAN interface: a QFX5100 sorts a packet on the port it arrives on, and an IRB interface takes no classifier. Write it on the VLAN's ports`
                );

        for (const { where, kind, scheduler } of Derive.scheduled(device)) {
            if (kind === "vlan_interface")
                found.push(
                    `${where}.scheduler on a VLAN interface: a QFX5100 schedules the queues of a port or LAG. Write it on the ports the VLAN leaves through`
                );
            const strict = qos?.schedulers?.[scheduler]?.queues.some((queue) => queue.priority === "strict" && queue.max);
            if (kind === "lag" && strict)
                found.push(`${where}.scheduler, with a strict queue's max: on a LAG the platform shapes each member to the rate`);
        }

        return found;
    }

    /** A QFX5100 queues what it floods and multicasts apart from the classes, in queues of their own (Juniper's CoS support by platform). */
    static findings(device: Device): Finding[] {
        if (!Derive.scheduled(device).some(({ kind }) => kind !== "vlan_interface")) return [];
        return [
            {
                level: "warning",
                device: device.name,
                message:
                    "qos.schedulers: a QFX5100 sends broadcast, multicast, and flooded frames from a queue of their own, mcast, which no class of a scheduler holds",
            },
        ];
    }

    /** Only `commit check` ran on a QFX5100, in a candidate that was never committed. */
    static experimental(device: Device): string[] {
        const qos = device.qos;
        const fields = (["classes", "default_class", "schedulers"] as const).filter((field) => qos?.[field] !== undefined);
        return [
            ...fields.map((field) => `qos.${field}`),
            ...Derive.scheduled(device).map(({ where }) => `${where}.scheduler`),
            ...Derive.trusting(device).map(({ where }) => `${where}.qos_trust`),
        ];
    }
}
