// What Studio shows, gathered from a project in one pass: each device as the model holds it, what each would run, what `validate` finds, the graph, the addresses, every BGP session and every cable.

import { basename } from "node:path";
import { Validation } from "../checks";
import { Address } from "../core/address";
import { Secrets } from "../core/secrets";
import { Topology } from "../core/topology";
import type { Device } from "../model";
import { Platforms } from "../platforms";
import { Catalog } from "../platforms/catalog";
import { Derive } from "../platforms/derive";
import type { Finding } from "../platforms/finding";
import { ProjectError, type ProjectRead, readProject, secretsFileOf } from "../project/project";
import type { AddressRow, Cable, Session, StudioData, StudioError } from "./types";

export class StudioModel {
    /** Read the project and gather what Studio shows, or what stopped the read. */
    static async gather(root: string): Promise<StudioData | StudioError> {
        let read: ProjectRead;
        try {
            read = await readProject(root);
        } catch (error) {
            if (error instanceof ProjectError) return { error: error.lines.join("\n") };
            return { error: (error as Error).message };
        }

        return StudioModel.build(basename(root), read);
    }

    private static attempt<T>(work: () => T, otherwise: (error: Error) => T): T {
        try {
            return work();
        } catch (error) {
            return otherwise(error as Error);
        }
    }

    static build(project: string, read: ProjectRead): StudioData {
        const devices = read.networks.flatMap((network) => Object.values(network.devices));
        const findings: Finding[] = [
            ...read.warnings.map((message) => ({ level: "warning" as const, message })),
            ...read.networks.flatMap((network) => Validation.run(Object.values(network.devices), network.settings.checks)),
        ];

        return {
            project,
            networks: read.networks.map((network) => ({
                name: network.name,
                ...(network.asn !== undefined ? { asn: network.asn } : {}),
                sites: network.settings.sites ?? {},
                devices: Object.keys(network.devices),
                secretsFile: secretsFileOf(network),
                secrets: [...Secrets.referencesIn([network.devices, network.settings.integrations])]
                    .filter((name) => !name.startsWith("file:"))
                    .sort(),
            })),
            devices,
            files: Object.fromEntries(read.networks.flatMap((network) => Object.entries(network.files))),
            ports: Object.fromEntries(
                devices.map((device) => [
                    device.name,
                    StudioModel.attempt(
                        () => Catalog.ports(device.platform, device.model),
                        () => []
                    ),
                ])
            ),
            rendered: Object.fromEntries(
                devices.map((device) => [
                    device.name,
                    StudioModel.attempt(
                        () => Platforms.find(device.platform)?.render(device) ?? `Cannot be rendered: no platform ${device.platform}`,
                        (error) => `Cannot be rendered: ${error.message}`
                    ),
                ])
            ),
            findings,
            graph: Topology.of(devices),
            addresses: StudioModel.addressesOf(devices),
            sessions: StudioModel.sessionsOf(devices),
            cables: StudioModel.cablesOf(devices),
            secrets: [...Secrets.referencesIn(read.networks.map((network) => [network.devices, network.settings.integrations]))]
                .filter((name) => !name.startsWith("file:"))
                .sort(),
        };
    }

    private static addressesOf(devices: readonly Device[]): AddressRow[] {
        return Topology.holders(devices).map((holder) => ({
            device: holder.device.name,
            holder: holder.name,
            address: holder.address,
            prefix: Address.prefixOf(holder.address),
            family: Address.family(holder.address),
            ...(holder.peer ? { peer: holder.peer } : {}),
            ...(holder.vrf ? { vrf: holder.vrf } : {}),
        }));
    }

    private static sessionsOf(devices: readonly Device[]): Session[] {
        const owners = Topology.owners(Topology.holders(devices));
        const all = Topology.sessionsOf(devices);
        const ownerOf = (address: string) => owners.get(Topology.keyOf(address) ?? "")?.device;

        return all.map(({ device, ownAs: _ownAs, ...session }) => {
            const base: Session = {
                device: device.name,
                name: session.name,
                address: session.address,
                ...(session.group ? { group: session.group } : {}),
                ...(session.remoteAs !== undefined ? { remoteAs: session.remoteAs } : {}),
                ...(session.role ? { role: session.role } : {}),
                ...(session.import ? { import: session.import } : {}),
                ...(session.export ? { export: session.export } : {}),
                ...(session.description ? { description: session.description } : {}),
            };
            const far = ownerOf(session.address);

            if (far && far !== device) {
                // The session back is one of the same family: a v4 session back does not answer a v6 session.
                const back = all.some(
                    (other) =>
                        other.device === far &&
                        ownerOf(other.address) === device &&
                        Address.family(other.address) === Address.family(session.address)
                );
                return { ...base, far: far.name, ...(back ? {} : { oneSided: true as const }) };
            }

            return { ...base, ...(session.remoteAs ? { far: `AS${session.remoteAs}` } : {}) };
        });
    }

    private static cablesOf(devices: readonly Device[]): Cable[] {
        const byName = new Map(devices.map((device) => [device.name, device]));
        const drawn = new Set<string>();
        const cables: Cable[] = [];

        for (const device of devices) {
            for (const [portName, port] of Derive.ports(device)) {
                const link = port.link;
                if (!link) continue;

                const here = `${device.name} ${portName}`;
                const there = `${link.device} ${link.port}`;
                if (drawn.has(`${there}|${here}`)) continue;
                drawn.add(`${here}|${there}`);

                const farPort = byName.get(link.device)?.interfaces?.ethernet?.[link.port];
                const linksBack = farPort?.link?.device === device.name && farPort.link.port === portName;
                const vlans = Topology.carriedBy(device, Topology.carrierOf(device, port)).map((vlan) => `${vlan.name} (${vlan.id})`);

                cables.push({
                    device: device.name,
                    port: portName,
                    farDevice: link.device,
                    farPort: link.port,
                    ...(port.in_lag ? { lag: port.in_lag } : {}),
                    ...(farPort?.in_lag ? { farLag: farPort.in_lag } : {}),
                    ...(port.description ? { description: port.description } : {}),
                    ...(link.through ? { through: link.through } : {}),
                    vlans,
                    ...(linksBack ? {} : { oneSided: true as const }),
                });
            }
        }

        return cables;
    }
}
