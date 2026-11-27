// Classes on Raisecom ROS. A port sorts what arrives into a local priority, 0 to 7, its queue. A port that trusts the DSCP takes a map of each class's DSCPs. Every other port takes a map of every DSCP to queue 0, the default class's, as a routed port refuses to trust its own priority. A RAX721 on ROS 6.5.2 took them on spare ports (TRAPS.md).

import { Derive } from "../../core/derive";
import type { Device, Port } from "../../model";
import type { Group } from "../line-diff";

export class RaisecomRosQos {
    /** The DSCP maps Circuit writes, of the 7 the switch takes: the classes', and the one that puts every DSCP in the default class. Map 0 is the switch's own, which every port uses until told. */
    static readonly DSCP_MAP = 1;
    static readonly UNTRUSTED_MAP = 2;

    /** A port's queues, by local priority. */
    private static readonly QUEUES = 8;

    private static readonly DSCPS = 64;

    /** The switch's own map puts the DSCPs of each class selector in one queue: 0 to 7 in queue 0, 8 to 15 in queue 1, and on. */
    private static readonly DSCPS_PER_QUEUE = 8;

    /** The map's header, and a line of it, as the switch prints them. */
    private static readonly MAP = /^mls qos mapping dscp-to-local-priority \d+$/;
    private static readonly MAP_LINE = /^dscp (\d+) to local-priority \d+$/;

    /** The queue of each class: `default_class` queue 0, and the others from queue 1 in the order `qos.classes` lists them. */
    static queues(device: Device): Map<string, number> {
        const fallback = device.qos?.default_class;
        const others = Object.keys(device.qos?.classes ?? {}).filter((name) => name !== fallback);
        return new Map(fallback ? [[fallback, 0], ...others.map((name, at) => [name, at + 1] as [string, number])] : []);
    }

    /** The DSCP maps, each DSCP's queue where it differs from the switch's own map, the only lines the switch prints. In the classes' map, a DSCP no other class lists takes the default class's queue. The other map is written once a port trusts nothing. */
    static lines(device: Device): string[] {
        if (!device.qos?.default_class) return [];

        const queues = RaisecomRosQos.queues(device);
        const byDscp = new Map<number, number>();
        for (const [name, settings] of Object.entries(device.qos.classes ?? {})) {
            if (name === device.qos.default_class) continue;
            for (const dscp of settings?.dscp ?? []) byDscp.set(Derive.DSCP[dscp], queues.get(name)!);
        }

        const untrusted = Derive.ports(device).some(([, port]) => !port.in_lag && !RaisecomRosQos.trusts(port));
        return [
            ...RaisecomRosQos.map(RaisecomRosQos.DSCP_MAP, (dscp) => byDscp.get(dscp) ?? 0),
            ...(untrusted ? RaisecomRosQos.map(RaisecomRosQos.UNTRUSTED_MAP, () => 0) : []),
        ];
    }

    private static map(number: number, queueOf: (dscp: number) => number): string[] {
        const lines = [`mls qos mapping dscp-to-local-priority ${number}`];
        for (let dscp = 0; dscp < RaisecomRosQos.DSCPS; dscp++) {
            const queue = queueOf(dscp);
            if (queue !== RaisecomRosQos.ownQueue(dscp)) lines.push(`   dscp ${dscp} to local-priority ${queue}`);
        }
        return [...lines, "!"];
    }

    private static trusts(port: Port): boolean {
        return (port.qos_trust ?? []).includes("dscp");
    }

    /** Every port sorts by the DSCP, through the classes' map where it trusts it, else through the map that puts every DSCP in the default class. A routed port trusts the DSCP by default, which prints nothing, and a switched port the PCP. Nothing without classes, so the switch's own trust stays. */
    static portLines(device: Device, port: Port, routed = false): string[] {
        if (!device.qos?.default_class) return [];
        const map = RaisecomRosQos.trusts(port) ? RaisecomRosQos.DSCP_MAP : RaisecomRosQos.UNTRUSTED_MAP;
        return [...(routed ? [] : ["mls qos trust dscp"]), `mls qos dscp-to-local-priority ${map}`];
    }

    /** A line of the map goes back to the switch's own queue for its DSCP, which then prints nothing. Undefined for any other line. */
    static undo(line: string): string | undefined {
        const dscp = RaisecomRosQos.MAP_LINE.exec(line)?.[1];
        return dscp === undefined ? undefined : `dscp ${dscp} to local-priority ${RaisecomRosQos.ownQueue(Number(dscp))}`;
    }

    /** The part of a map's line that says which DSCP it sets, so a new queue for a DSCP replaces the old in place. */
    static head(line: string): string | undefined {
        return /^dscp \d+ to local-priority/.exec(line)?.[0];
    }

    /** The line a port binds a map with, from the map's header. Undefined for any other line. */
    static binding(header: string): string | undefined {
        const number = /^mls qos mapping dscp-to-local-priority (\d+)$/.exec(header)?.[1];
        return number === undefined ? undefined : `mls qos dscp-to-local-priority ${number}`;
    }

    /** A map a port uses can't change: `Map is being used.` So each port lets go of it first, back to the switch's own map. Each that keeps it binds it again after, and one that takes another map does so in its own step. */
    static around(binding: string, before: string[], after: string[]): { before: string[]; after: string[] } {
        const kept = before.filter((port) => after.includes(port));
        return {
            before: before.flatMap((port) => [port, "no mls qos dscp-to-local-priority", "exit"]),
            after: kept.flatMap((port) => [port, binding, "exit"]),
        };
    }

    /** Takes each gone map out of the top level, to go once no port uses it. */
    static removed(top: Group | undefined): string[] {
        if (!top) return [];
        const maps = top.remove.filter((line) => RaisecomRosQos.MAP.test(line));
        top.remove = top.remove.filter((line) => !maps.includes(line));
        return maps;
    }

    private static ownQueue(dscp: number): number {
        return Math.floor(dscp / RaisecomRosQos.DSCPS_PER_QUEUE);
    }

    /** What the switch can't do with classes, or what was not tried on it. */
    static unsupported(device: Device): string[] {
        const qos = device.qos;
        const found: string[] = [];
        const names = Object.keys(qos?.classes ?? {});
        if (names.length > RaisecomRosQos.QUEUES)
            found.push(`qos.classes, ${names.length} of them: a port has ${RaisecomRosQos.QUEUES} queues`);

        for (const [name, settings] of Object.entries(qos?.classes ?? {}))
            if (name !== qos?.default_class && settings?.pcp?.length)
                found.push(
                    `qos.classes.${name}.pcp, a port here binds no PCP map: \`mls qos mapping cos-to-local-priority\` makes one, but no line on a port takes it`
                );
        if (names.length && Object.keys(device.interfaces?.lag ?? {}).length)
            found.push("qos.classes beside a LAG, not built yet: no LAG has taken the trust settings");

        // `mls qos flow-queue profile` shapes each queue alone, and the port refuses `mls qos queue` (TRAPS.md).
        const noScheduler =
            "ROS 6.5.2 has no queue scheduler to set: a port's flow-queue profile shapes each queue alone, and `mls qos queue` is refused";
        for (const name of Object.keys(qos?.schedulers ?? {})) found.push(`qos.schedulers.${name}, ${noScheduler}`);
        for (const { where } of Derive.scheduled(device)) found.push(`${where}.scheduler, ${noScheduler}`);

        if (qos?.marking)
            found.push(
                "qos.marking, not built: the switch marks with a traffic policy on the port a packet arrives on, which marks what it switches within a VLAN as well as what it routes"
            );

        for (const { where, kind } of Derive.trusting(device))
            if (kind === "vlan_interface")
                found.push(
                    `${where}.qos_trust on a VLAN interface: the switch sorts a packet on the port it arrives on. Write it on the VLAN's ports`
                );

        // A policer profile takes `cir cbs pir pbs`, but its only action for a color is `set-pri green`, and `rate-limit` takes `pir pbs` with no action at all.
        for (const { where } of Derive.twoRates(device))
            found.push(
                `${where}, two rates: the switch polices them, but writes no DSCP on what exceeds, as a policer sets only a local priority. Write one rate`
            );

        return found;
    }

    /** Taken and read back on a spare port, but no packet crossed it. */
    static experimental(device: Device): string[] {
        const found = device.qos?.default_class ? ["qos.classes"] : [];
        for (const { where } of Derive.trusting(device)) found.push(`${where}.qos_trust`);
        return found;
    }
}
