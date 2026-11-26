// NetFlow v9 on VRP, which Huawei calls NetStream (RFC 3954): the IPv4 and IPv6 flows each watched port receives, sampled, exported to the collectors. A CE6855 on V200R005C00SPC800 committed it on a spare port (TRAPS.md).

import { Address } from "../../core/address";
import { Derive } from "../../core/derive";
import type { Device } from "../../model";

export class VrpNetStream {
    /** The families the switch keeps flows of, as it spells them. */
    private static readonly FAMILIES = ["ip", "ipv6"] as const;

    /** The collector's UDP port when the config sets none: NetFlow v9's common one, as the language has it. */
    private static readonly PORT = 2055;

    /** The most collectors of each family: the switch refused a third, "has reached the upper limit (2)". */
    private static readonly COLLECTORS = 2;

    /** The timeouts the switch uses when the config sets none, in seconds: 30 minutes for a flow still running, and 30 seconds without a packet. They are not printed. */
    private static readonly DEFAULT_S = { active: 1800, idle: 30 };

    /** The timeouts the switch takes, in seconds: it takes the active one in whole minutes, from 1 to 60. */
    private static readonly ACTIVE_S = { min: 60, max: 3600 };
    private static readonly IDLE_S = { min: 5, max: 600 };

    private static readonly SECONDS_PER_MINUTE = 60;

    /** The sampling rates the switch takes. */
    private static readonly SAMPLING = { min: 1, max: 65535 };

    /** A collector's line, one of a list. */
    private static readonly COLLECTOR = /^netstream export (ip|ipv6) host /;

    /** Version 9, each collector, and the timeouts the config sets, for each family. Then a separator. Nothing without NetFlow v9. */
    static lines(device: Device): string[] {
        const flow = device.monitoring?.flow_export;
        if (flow?.protocol !== "netflow-v9") return [];

        const lines: string[] = [];
        for (const family of VrpNetStream.FAMILIES) {
            lines.push(`netstream export ${family} version 9`);
            for (const collector of flow.collectors)
                lines.push(`netstream export ${family} host ${collector.address} ${collector.port ?? VrpNetStream.PORT}`);

            const { active, idle } = VrpNetStream.DEFAULT_S;
            if (flow.active_timeout !== undefined && flow.active_timeout !== active)
                lines.push(`netstream timeout ${family} active ${flow.active_timeout / VrpNetStream.SECONDS_PER_MINUTE}`);
            if (flow.idle_timeout !== undefined && flow.idle_timeout !== idle)
                lines.push(`netstream timeout ${family} inactive ${flow.idle_timeout}`);
        }

        return [...lines, "#"];
    }

    /** What a watched port keeps flows of, and how it samples them. */
    static portLines(device: Device, port: string): string[] {
        const flow = device.monitoring?.flow_export;
        if (flow?.protocol !== "netflow-v9" || (flow.interfaces && !flow.interfaces.includes(port))) return [];

        return ["netstream inbound ip", "netstream inbound ipv6", `netstream sampler random-packets ${flow.sampling} inbound`];
    }

    /** What the switch can't export as the config says. */
    static unsupported(device: Device): string[] {
        const flow = device.monitoring?.flow_export;
        if (flow?.protocol !== "netflow-v9") return [];

        const found: string[] = [];
        const where = "monitoring.flow_export";
        const { min, max } = VrpNetStream.SAMPLING;
        const sampling = flow.sampling;

        if (sampling === undefined || !VrpNetStream.inRange(sampling, VrpNetStream.SAMPLING))
            found.push(
                `${where}.sampling, required and from ${min} to ${max} on the platform: whether the switch keeps every packet without a sampler is not known`
            );
        if (flow.collectors.length > VrpNetStream.COLLECTORS)
            found.push(`${where}.collectors, ${VrpNetStream.COLLECTORS} at most on the platform`);
        for (const collector of flow.collectors)
            if (Address.family(collector.address) === "ipv6") found.push(`${where}.collectors ${collector.address}, IPv6 is not tested`);

        const ports = new Set(Derive.ports(device).map(([name]) => name));
        for (const name of flow.interfaces ?? [])
            if (!ports.has(name)) found.push(`${where}.interfaces ${name}, the platform watches ports: NetStream elsewhere is not tested`);

        const active = flow.active_timeout;
        const { min: fewest, max: most } = VrpNetStream.ACTIVE_S;
        if (
            active !== undefined &&
            (active % VrpNetStream.SECONDS_PER_MINUTE !== 0 || !VrpNetStream.inRange(active, VrpNetStream.ACTIVE_S))
        )
            found.push(`${where}.active_timeout, whole minutes from ${fewest} to ${most} seconds on the platform`);
        const idle = flow.idle_timeout;
        if (idle !== undefined && !VrpNetStream.inRange(idle, VrpNetStream.IDLE_S))
            found.push(`${where}.idle_timeout, from ${VrpNetStream.IDLE_S.min} to ${VrpNetStream.IDLE_S.max} seconds on the platform`);

        return found;
    }

    /** The undo of a version or a timeout takes no value, and of a port's sampler no rate. Undefined for a line undone whole. */
    static undo(line: string): string | undefined {
        const setting = /^(netstream (?:export \S+ version|timeout \S+ (?:active|inactive))) \d+$/.exec(line);
        if (setting) return `undo ${setting[1]}`;
        return line.startsWith("netstream sampler random-packets ") ? "undo netstream sampler inbound" : undefined;
    }

    /** Each collector is one of a list, and a new rate replaces the port's sampler. */
    static head(line: string): string | undefined {
        if (VrpNetStream.COLLECTOR.test(line)) return line;
        return line.startsWith("netstream sampler random-packets ") ? "netstream sampler random-packets" : undefined;
    }

    private static inRange(value: number, range: { min: number; max: number }): boolean {
        return Number.isInteger(value) && value >= range.min && value <= range.max;
    }
}
