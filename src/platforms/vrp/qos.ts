// Classes and schedulers on VRP. A DiffServ domain of Circuit's own puts each class's DSCPs or PCPs into one of a port's 8 queues, and each port that trusts them takes it. The others take a domain that puts every PCP into the default class's queue. A port's scheduler sends its strict queue first (PQ) and the others by weight (DRR). A CE6855 on V200R005C00SPC800 took them on a spare port (TRAPS.md).

import { Derive } from "../../core/derive";
import type { Device, MarkingRule, Port, Rate } from "../../model";
import { LineDiff } from "../line-diff";
import type { Dialect, Group } from "../line-diff";

/** What sorts a port's packets into classes: the DSCP of an IP packet, or the PCP of its VLAN tag. */
type Trust = "dscp" | "pcp";

export class VrpQos {
    /** A port's queues by their service class, queue 0 first. */
    private static readonly SERVICE_CLASSES = ["be", "af1", "af2", "af3", "af4", "ef", "cs6", "cs7"] as const;

    /** The domain of each port that trusts what the classes sort by. */
    private static readonly DOMAIN = "circuit";

    /** The domain of each other port: it trusts the PCP, as a port does unless told otherwise, and puts every PCP in queue 0, the default class's. */
    private static readonly UNTRUSTED = "circuit-untrusted";

    private static readonly DSCPS = 64;

    private static readonly PCPS = 8;

    /** The DSCPs of one service class in the switch's own mapping. */
    private static readonly DSCPS_PER_CLASS = 8;

    /** The color the switch's own mapping gives a DSCP: green, but for the AF drop precedences. The domain keeps it. */
    private static readonly COLOR: Readonly<Record<number, string>> = {
        12: "yellow",
        14: "red",
        20: "yellow",
        22: "red",
        28: "yellow",
        30: "red",
        36: "yellow",
        38: "red",
    };

    /** A DRR queue's weight when none is set. The switch does not print it. */
    private static readonly WEIGHT = 1;

    private static readonly KBIT = 1000;

    /** The rates a queue's shaping takes, in kbit/s. */
    private static readonly SHAPING_KBIT = { min: 64, max: 100_000_000 };

    /** A port header, `interface 10GE1/0/1`: not a LAG, nor a VLAN interface. */
    private static readonly PORT = /^interface (?!Eth-Trunk|Vlanif)\S+$/;

    /** The queue of each class: `default_class` queue 0, and the others from queue 1 in the order `qos.classes` lists them. */
    static queues(device: Device): Map<string, number> {
        const fallback = device.qos?.default_class;
        const others = Object.keys(device.qos?.classes ?? {}).filter((name) => name !== fallback);
        return new Map(fallback ? [[fallback, 0], ...others.map((name, at) => [name, at + 1] as [string, number])] : []);
    }

    /** What the classes sort by: the DSCP when a class other than the default lists one, else the PCP. Nothing without classes. */
    static trust(device: Device): Trust | undefined {
        const qos = device.qos;
        if (!qos?.default_class) return undefined;
        const others = Object.entries(qos.classes ?? {}).filter(([name]) => name !== qos.default_class);
        return others.some(([, settings]) => settings?.dscp?.length) ? "dscp" : "pcp";
    }

    /** The domain: the queue of each DSCP and each PCP, where it differs from the switch's own. A DSCP or PCP no other class lists takes the default class's queue. */
    static lines(device: Device): string[] {
        const trust = VrpQos.trust(device);
        if (!trust) return [];

        const queues = VrpQos.queues(device);
        const byDscp = new Map<number, number>();
        const byPcp = new Map<number, number>();
        for (const [name, settings] of Object.entries(device.qos?.classes ?? {})) {
            if (name === device.qos?.default_class) continue;
            for (const dscp of settings?.dscp ?? []) byDscp.set(Derive.DSCP[dscp], queues.get(name)!);
            for (const pcp of settings?.pcp ?? []) byPcp.set(pcp, queues.get(name)!);
        }

        const lines: string[] = [];
        const { SERVICE_CLASSES: classes, DSCPS_PER_CLASS: perClass } = VrpQos;
        // Trusting the DSCP, the switch sorts a packet without one by its PCP, and Circuit puts it in the default class.
        for (let pcp = 0; pcp < VrpQos.PCPS; pcp++) {
            const queue = trust === "pcp" ? (byPcp.get(pcp) ?? 0) : 0;
            if (queue !== pcp) lines.push(` 8021p-inbound ${pcp} phb ${classes[queue]} green`);
        }
        const dscps = trust === "dscp" ? VrpQos.DSCPS : 0;
        for (let dscp = 0; dscp < dscps; dscp++) {
            const queue = byDscp.get(dscp) ?? 0;
            if (queue !== Math.floor(dscp / perClass))
                lines.push(` ip-dscp-inbound ${dscp} phb ${classes[queue]} ${VrpQos.COLOR[dscp] ?? "green"}`);
        }

        const untrusted = Derive.ports(device).some(([, port]) => !port.in_lag && !VrpQos.trusts(device, port));
        const untrustedLines = Array.from({ length: VrpQos.PCPS - 1 }, (_, at) => ` 8021p-inbound ${at + 1} phb ${classes[0]} green`);
        return [
            `diffserv domain ${VrpQos.DOMAIN}`,
            ...lines,
            "#",
            ...(untrusted ? [`diffserv domain ${VrpQos.UNTRUSTED}`, ...untrustedLines, "#"] : []),
        ];
    }

    /** Whether a port trusts what the classes sort by. */
    private static trusts(device: Device, port: Port): boolean {
        const trust = VrpQos.trust(device);
        return trust !== undefined && (port.qos_trust ?? []).includes(trust);
    }

    /** A port's trust, then its scheduler. A port that trusts what the classes sort by takes Circuit's domain, the others the untrusted one, and each keeps the PCP a packet arrives with. */
    static portLines(device: Device, port: Port): string[] {
        const trust = VrpQos.trust(device);
        if (!trust) return [];

        const trusted = VrpQos.trusts(device, port);
        const domain = trusted ? VrpQos.DOMAIN : VrpQos.UNTRUSTED;
        const lines = [...(trusted && trust === "dscp" ? ["trust dscp"] : []), `trust upstream ${domain}`, "qos phb marking 8021p disable"];
        const scheduler = port.scheduler ? device.qos?.schedulers?.[port.scheduler] : undefined;
        if (!scheduler) return lines;

        // Every queue is strict until set otherwise, and a weight needs its queue weighted first.
        const queues = VrpQos.queues(device);
        const weighted = scheduler.queues.filter((queue) => queue.share !== undefined);
        if (weighted.length) lines.push(`qos drr ${VrpQos.list(weighted.map((queue) => queues.get(queue.class)!))}`);
        for (const queue of [...scheduler.queues].sort((a, b) => queues.get(a.class)! - queues.get(b.class)!)) {
            const index = queues.get(queue.class)!;
            if (queue.share !== undefined && queue.share !== VrpQos.WEIGHT) lines.push(`qos queue ${index} drr weight ${queue.share}`);
            if (queue.max) lines.push(`qos queue ${index} shaping cir ${VrpQos.kbit(queue.max)} kbps pir ${VrpQos.kbit(queue.max)} kbps`);
        }
        if (scheduler.rate) lines.push(`qos lr cir ${VrpQos.kbit(scheduler.rate)} kbps outbound`);

        return lines;
    }

    /** The service class a marking rule's packets take: the class it gives them, else the class that lists the DSCP it writes. Else, by DSCP, the default class. Undefined when the queue stays as the port sorted it. */
    static markedClass(device: Device, rule: MarkingRule): string | undefined {
        const queues = VrpQos.queues(device);
        const set = rule.then.class;
        if (set !== undefined) return VrpQos.SERVICE_CLASSES[queues.get(set)!];

        const dscp = rule.then.dscp;
        const trust = VrpQos.trust(device);
        if (dscp === undefined || !trust) return undefined;
        const holder = Object.entries(device.qos?.classes ?? {}).find(([, settings]) => settings?.dscp?.includes(dscp));
        if (holder) return VrpQos.SERVICE_CLASSES[queues.get(holder[0])!];
        return trust === "dscp" ? VrpQos.SERVICE_CLASSES[0] : undefined;
    }

    /** What the classes and schedulers can't do here. */
    static unsupported(device: Device): string[] {
        const qos = device.qos;
        const found: string[] = [];
        const names = Object.keys(qos?.classes ?? {});
        if (names.length > VrpQos.SERVICE_CLASSES.length)
            found.push(`qos.classes, ${names.length} of them: a port has ${VrpQos.SERVICE_CLASSES.length} queues`);

        const others = Object.entries(qos?.classes ?? {}).filter(([name]) => name !== qos?.default_class);
        if (others.some(([, settings]) => settings?.dscp?.length) && others.some(([, settings]) => settings?.pcp?.length))
            found.push(
                "qos.classes by DSCP and by PCP at once: a port sorts its packets by their DSCP or by their PCP, not by the DSCP and then the PCP"
            );
        if (names.length && Object.keys(device.interfaces?.lag ?? {}).length)
            found.push("qos.classes beside a LAG, not built yet: no Eth-Trunk has taken the trust settings");

        for (const [name, scheduler] of Object.entries(qos?.schedulers ?? {})) {
            const where = `qos.schedulers.${name}`;
            const strict = scheduler?.queues.filter((queue) => queue.priority === "strict") ?? [];
            if (strict.length > 1)
                found.push(`${where}, ${strict.length} strict queues: the switch sends the higher queue first, where Circuit's take turns`);
            scheduler?.queues.forEach((queue, index) => {
                const at = `${where}.queues[${index}]`;
                if (queue.depth_packets !== undefined) found.push(`${at}.depth_packets, V200R005 sets no depth in packets`);
                if (queue.red) found.push(`${at}.red, which needs depth_packets`);
                if (queue.max && !VrpQos.shapes(queue.max))
                    found.push(
                        `${at}.max, whole kbit/s from ${VrpQos.SHAPING_KBIT.min}k to ${VrpQos.SHAPING_KBIT.max / VrpQos.KBIT / VrpQos.KBIT}G`
                    );
            });
            if (scheduler?.rate && !Number.isInteger(Derive.bitsPerSecond(scheduler.rate) / VrpQos.KBIT))
                found.push(`${where}.rate, the platform takes a rate in whole kbit/s`);
        }

        for (const { where, kind } of Derive.trusting(device))
            if (kind === "vlan_interface")
                found.push(
                    `${where}.qos_trust on a VLAN interface: the switch sorts a packet on the port it arrives on. Write it on the VLAN's ports`
                );
        for (const { where, kind } of Derive.scheduled(device))
            if (kind !== "ethernet")
                found.push(
                    `${where}.scheduler, on a ${kind === "lag" ? "LAG, not built yet" : "VLAN interface: the switch queues on its ports"}`
                );
        // A CAR profile takes no action for a color, and a behavior's car refuses remark-dscp for yellow (TRAPS.md).
        for (const { where } of Derive.twoRates(device))
            found.push(
                `${where}, two rates: a CE6855's CAR passes what exceeds with a service class and a color, not a DSCP. Write one rate`
            );
        for (const { where, rateLimit } of Derive.rateLimited(device))
            if (rateLimit.per_prefix)
                found.push(
                    `${where}.rate_limit.per_prefix, the CE6855 has no rate for each address: its CAR polices a port or a traffic class as a whole`
                );

        return found;
    }

    /** Proven by the configuration alone: the switch took them, but no packet was seen in a queue. */
    static experimental(device: Device): string[] {
        const found = Object.keys(device.qos?.classes ?? {}).length ? ["qos.classes"] : [];
        for (const name of Object.keys(device.qos?.schedulers ?? {})) found.push(`qos.schedulers.${name}`);
        (device.qos?.marking ?? []).forEach((rule, index) => {
            if (rule.then.class !== undefined) found.push(`qos.marking[${index}].then.class`);
        });
        for (const { where } of Derive.trusting(device)) found.push(`${where}.qos_trust`);
        return found;
    }

    /** `0 to 2 4`: queues as the switch takes a list of them. */
    private static list(queues: number[]): string {
        const sorted = [...new Set(queues)].sort((a, b) => a - b);
        const ranges: string[] = [];
        for (let at = 0; at < sorted.length; at++) {
            let end = at;
            while (sorted[end + 1] === sorted[end]! + 1) end++;
            ranges.push(at === end ? `${sorted[at]}` : `${sorted[at]} to ${sorted[end]}`);
            at = end;
        }
        return ranges.join(" ");
    }

    private static kbit(rate: Rate): number {
        return Derive.bitsPerSecond(rate) / VrpQos.KBIT;
    }

    private static shapes(rate: Rate): boolean {
        const kbit = VrpQos.kbit(rate);
        return Number.isInteger(kbit) && kbit >= VrpQos.SHAPING_KBIT.min && kbit <= VrpQos.SHAPING_KBIT.max;
    }

    /** The lines undone by their keyword and number alone. Undefined for any other line. */
    static undo(line: string): string | undefined {
        if (line === "trust dscp") return "undo trust";
        const kept = /^(trust upstream|qos queue \d+ shaping|qos queue \d+ drr weight|ip-dscp-inbound \d+|8021p-inbound \d+) /.exec(line);
        return kept ? `undo ${kept[1]}` : undefined;
    }

    /**
     * `undo qos drr` takes the weights of its queues with it. So when a port's weighted queues change, every weight is sent again after the new list. A domain still trusted is refused at once, so it goes once no port trusts it: taken out of `top`, and returned.
     */
    static order(groups: Group[], desired: string, dialect: Dialect): string[] {
        const weight = /^qos queue \d+ drr weight /;
        for (const group of groups) {
            const header = group.path[0] ?? "";
            if (group.path.length !== 1 || !VrpQos.PORT.test(header)) continue;
            if (![...group.add, ...group.remove].some((line) => line.startsWith("qos drr "))) continue;

            const weights = LineDiff.entries(desired, dialect).filter((entry) => entry.path[0] === header && weight.test(entry.line));
            group.remove = group.remove.filter((line) => !weight.test(line));
            group.add = [...group.add.filter((line) => !weight.test(line)), ...weights.map((entry) => entry.line)];
        }

        const top = groups.find((group) => group.path.length === 0);
        const domains = top?.remove.filter((line) => line.startsWith("diffserv domain ")) ?? [];
        if (top) top.remove = top.remove.filter((line) => !domains.includes(line));
        return domains;
    }
}
