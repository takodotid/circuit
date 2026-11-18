// `diff` and `apply` read each device's LLDP neighbors while connected, and warn where they disagree with `link`.

import { Catalog } from "./catalog";
import type { Device, Finding } from "../model";

/** A device one of our ports sees at the far end of its cable, over LLDP. */
export type Neighbor = {
    /** Our port, by Circuit's name, such as `10g-1`. */
    port: string;
    /** The system name the far device sends, its hostname. */
    system: string;
    /** The far device's port, as that device spells it, such as `XGigabitEthernet0/0/1`. */
    remote_port: string;
};

export class Cabling {
    /** The device runs LLDP somewhere: on every port, on the interfaces it lists, or on a port that turns it on. */
    static runsAnywhere(device: Device): boolean {
        return Boolean(device.switching?.lldp) || Object.values(device.interfaces?.ethernet ?? {}).some((port) => port?.lldp === true);
    }

    /** The port runs LLDP, by the port's own `lldp`, or else the device's. */
    static runsOn(device: Device, port: string): boolean {
        const own = device.interfaces?.ethernet?.[port]?.lldp;
        if (own !== undefined) return own;

        const lldp = device.switching?.lldp;
        return lldp === true || (typeof lldp === "object" && (lldp.interfaces as readonly string[]).includes(port));
    }

    /**
     * Where LLDP and `link` disagree: a cable in another port, a cable LLDP does not see, or another of our devices on a port without `link`.
     *
     * Only ports where both ends run LLDP, by the config, are compared, on devices whose neighbors were read. LLDP can be off at the far end, so each is a warning.
     */
    static compare(devices: readonly Device[], neighbors: ReadonlyMap<string, readonly Neighbor[]>): Finding[] {
        const findings: Finding[] = [];

        for (const device of devices) {
            const seen = neighbors.get(device.name);
            if (!seen) continue;

            const warn = (message: string) => findings.push({ level: "warning", device: device.name, message });
            const linked = Object.entries(device.interfaces?.ethernet ?? {}).filter(([, port]) => port?.link);
            const ports = new Set([...linked.map(([name]) => name), ...seen.map((neighbor) => neighbor.port)]);

            for (const port of ports) {
                if (!Cabling.runsOn(device, port)) continue;

                const here = seen.filter((neighbor) => neighbor.port === port);
                const link = device.interfaces?.ethernet?.[port]?.link;

                if (!link) {
                    for (const far of Cabling.ours(devices, here))
                        warn(`port ${port}: LLDP sees ${far.name} ${far.port}, but the port has no link`);
                    continue;
                }

                // Through a carrier, LLDP sees the carrier's switches, not the far end.
                if (link.through) continue;

                const far = devices.find((candidate) => candidate.name === link.device);
                if (!far || !Cabling.runsOn(far, link.port)) continue;

                const named = `${link.device} ${link.port}`;

                if (!here.length) {
                    warn(`port ${port}: LLDP sees nothing, but link names ${named}: the cable is missing or down`);
                } else if (
                    !here.some(
                        (neighbor) => Cabling.isDevice(neighbor.system, far.name) && Cabling.isPort(far, link.port, neighbor.remote_port)
                    )
                ) {
                    const what = here.map((neighbor) => `${neighbor.system} ${neighbor.remote_port}`).join(" and ");
                    warn(`port ${port}: LLDP sees ${what}, but link names ${named}`);
                }
            }
        }

        return findings;
    }

    /** Our devices among the neighbors, each with its port by Circuit's name, where that port runs LLDP. */
    private static ours(devices: readonly Device[], neighbors: readonly Neighbor[]): { name: string; port: string }[] {
        return neighbors.flatMap((neighbor) => {
            const far = Cabling.deviceOf(devices, neighbor.system);
            if (!far) return [];

            const port = Cabling.portOf(far, neighbor.remote_port);
            return Cabling.runsOn(far, port) ? [{ name: far.name, port }] : [];
        });
    }

    /** A system name is the device's name, alone or with a domain after it. */
    private static isDevice(system: string, name: string): boolean {
        return system === name || system.startsWith(`${name}.`);
    }

    private static deviceOf(devices: readonly Device[], system: string): Device | undefined {
        return devices.find((device) => Cabling.isDevice(system, device.name));
    }

    /** A port LLDP reports, as the far device spells it, is that device's port by Circuit's name. */
    private static isPort(device: Device, port: string, reported: string): boolean {
        const tidy = (text: string) => text.replace(/\s+/g, "").toLowerCase();
        if (tidy(reported) === tidy(port)) return true;

        try {
            return tidy(Catalog.spell(device.platform, device.model, port)) === tidy(reported);
        } catch {
            return false;
        }
    }

    /** Circuit's name for a port LLDP reports, or the report itself when no port of the device is spelled that way. */
    private static portOf(device: Device, reported: string): string {
        let ports: string[] = [];

        try {
            ports = Catalog.devicePorts(device);
        } catch {
            return reported;
        }

        return ports.find((port) => Cabling.isPort(device, port, reported)) ?? reported;
    }
}
