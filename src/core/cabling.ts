// The cabling as LLDP sees it, compared with what `link` says. `snapshot` saves each device's LLDP neighbors beside its config; `validate` warns where they disagree.

import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Catalog } from "../platforms/catalog";
import type { Device } from "../schema";
import type { Finding } from "./define";

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
    /** The end of a state file that holds a device's LLDP neighbors, beside its config. */
    static readonly SUFFIX = ".lldp.json";

    /** The file a device's neighbors are saved in. */
    static path(stateDirectory: string, device: string): string {
        return join(stateDirectory, device + Cabling.SUFFIX);
    }

    /** Save what a device sees, sorted, so a file changes only when a neighbor does. */
    static save(stateDirectory: string, device: string, neighbors: readonly Neighbor[]): void {
        const sorted = [...neighbors].sort((a, b) => Cabling.order(a).localeCompare(Cabling.order(b)));
        const tidy = sorted.map(({ port, system, remote_port }) => ({ port, system, remote_port }));

        writeFileSync(Cabling.path(stateDirectory, device), JSON.stringify(tidy, null, 4) + "\n");
    }

    /** Forget what a device saw, when its neighbors could not be read this time. */
    static forget(stateDirectory: string, device: string): void {
        rmSync(Cabling.path(stateDirectory, device), { force: true });
    }

    /** What a device saw at its last snapshot, or undefined when its neighbors were never read. */
    static load(stateDirectory: string, device: string): Neighbor[] | undefined {
        const path = Cabling.path(stateDirectory, device);
        if (!existsSync(path)) return undefined;

        return JSON.parse(readFileSync(path, "utf8")) as Neighbor[];
    }

    private static order(neighbor: Neighbor): string {
        return `${neighbor.port} ${neighbor.system} ${neighbor.remote_port}`;
    }

    /** The device runs LLDP somewhere: on every port, on the interfaces it lists, or on a port that turns it on. */
    static runsAnywhere(device: Device): boolean {
        return Boolean(device.lldp) || Object.values(device.ports ?? {}).some((port) => port?.lldp === true);
    }

    /** The port runs LLDP, by the port's own `lldp`, or else the device's. */
    static runsOn(device: Device, port: string): boolean {
        const own = device.ports?.[port as keyof typeof device.ports]?.lldp;
        if (own !== undefined) return own;

        const lldp = device.lldp;
        return lldp === true || (typeof lldp === "object" && (lldp.interfaces as readonly string[]).includes(port));
    }

    /**
     * Warnings where LLDP and `link` disagree, from each device's own view: a cable in another port than `link` names, a cable `link` names that LLDP does not see, and another of our devices on a port without `link`.
     *
     * Only ports where both ends run LLDP, by the config, are compared, and only on devices whose neighbors were read. A link `through` a carrier is not compared. LLDP can be off at the far end, so each is a warning.
     */
    static compare(devices: readonly Device[], neighbors: ReadonlyMap<string, readonly Neighbor[]>): Finding[] {
        const findings: Finding[] = [];

        for (const device of devices) {
            const seen = neighbors.get(device.name);
            if (!seen) continue;

            const warn = (message: string) => findings.push({ level: "warning", device: device.name, message });
            const linked = Object.entries(device.ports ?? {}).filter(([, port]) => port?.link);
            const ports = new Set([...linked.map(([name]) => name), ...seen.map((neighbor) => neighbor.port)]);

            for (const port of ports) {
                if (!Cabling.runsOn(device, port)) continue;

                const here = seen.filter((neighbor) => neighbor.port === port);
                const link = device.ports?.[port as keyof typeof device.ports]?.link;

                if (!link) {
                    for (const neighbor of here) {
                        const far = Cabling.deviceOf(devices, neighbor.system);
                        if (!far) continue;

                        const farPort = Cabling.portOf(far, neighbor.remote_port);
                        if (Cabling.runsOn(far, farPort)) warn(`port ${port}: LLDP sees ${far.name} ${farPort}, but the port has no link`);
                    }
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

    /**
     * Each linked port without a description gets one from its far end: the far device and the far port as printed on it, such as `firewall-1 port6`. The far device's own file has its platform and model, so the label is never written twice. A port whose far device is not in the network keeps none.
     */
    static describeLinks(devices: readonly Device[]): Device[] {
        const byName = new Map(devices.map((device) => [device.name, device]));

        return devices.map((device) => {
            const ports = Object.entries(device.ports ?? {});
            if (!ports.some(([, port]) => port?.link && port.description === undefined)) return device;

            const described = ports.map(([name, port]) => {
                const far = port?.link ? byName.get(port.link.device) : undefined;
                if (!port?.link || port.description !== undefined || !far) return [name, port];

                return [name, { ...port, description: `${far.name} ${Cabling.labelOf(far, port.link.port)}` }];
            });

            return { ...device, ports: Object.fromEntries(described) } as Device;
        });
    }

    /** A port as printed on the device, or Circuit's name for it when the model has no spelling for it. */
    private static labelOf(device: Device, port: string): string {
        try {
            return Catalog.spell(device.platform, device.model, port);
        } catch {
            return port;
        }
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
            ports = Catalog.ports(device.platform, device.model);
        } catch {
            return reported;
        }

        return ports.find((port) => Cabling.isPort(device, port, reported)) ?? reported;
    }
}
