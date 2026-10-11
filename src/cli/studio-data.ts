// What studio shows, gathered from the config in one pass: the graph with its findings and drift, each device as the config holds it, what each would run, the address plan, every BGP session and cable, and the schema's descriptions of each field.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { portsOf } from "../adapters/devices/catalog";
import { host } from "../core/addr";
import { type AddressReport, addressesOf } from "../core/addresses";
import { type Holder, holdersOf, keyOf } from "../core/graph";
import { SCHEMA_FILES, schemaTypes } from "../core/schema-docs";
import type { Device } from "../schema";
import type { Annotated } from "./graph";

/** One BGP session, with its group's settings filled in, and what is at its far end. */
export type Session = {
    device: string;
    name: string;
    address: string;
    group?: string;
    remoteAs?: number;
    role?: string;
    import?: string;
    export?: string;
    description?: string;
    /** One of our devices, by name, or another network, as `AS64501`. */
    far?: string;
    /** The far device has no session back. */
    oneSided?: true;
};

/** One cable, from the end that names it first. */
export type Cable = {
    device: string;
    port: string;
    farDevice: string;
    farPort: string;
    /** The LAG each end's port is in. */
    lag?: string;
    farLag?: string;
    description?: string;
    /** VLANs carried, as `name (id)`, from the port or its LAG. */
    vlans: string[];
    /** The far end does not name this cable back. */
    oneSided?: true;
};

/** A schema type's description and its fields' descriptions, by field path. */
export type TypeDocs = {
    description: string;
    includes: string[];
    fields: Record<string, { type: string; description: string }>;
};

export type StudioData = {
    graph: Annotated;
    devices: readonly Device[];
    /** Every port each device's model has, in order, so studio can show the ones the config leaves shut. */
    ports: Record<string, string[]>;
    /** What each device would run, as `circuit build` prints it, or why it cannot be rendered. */
    rendered: Record<string, string>;
    addresses: AddressReport;
    sessions: Session[];
    cables: Cable[];
    /** By type name. */
    docs: Record<string, TypeDocs>;
};

function sessionsOf(devices: readonly Device[], owners: Map<string, Holder>): Session[] {
    const all = devices.flatMap((device) => {
        const bgp = device.routing?.bgp;

        return Object.entries(bgp?.neighbors ?? {}).map(([name, neighbor]): Session & { deviceObject: Device } => {
            const group = neighbor.group ? bgp?.groups?.[neighbor.group] : undefined;
            const settings = { ...group, ...neighbor };

            return {
                deviceObject: device,
                device: device.name,
                name,
                address: neighbor.address,
                group: neighbor.group,
                remoteAs: settings.remote_as,
                role: settings.role,
                import: settings.import,
                export: settings.export,
                description: settings.description,
            };
        });
    });

    const ownerOf = (address: string) => owners.get(keyOf(address) ?? "")?.device;

    return all.map(({ deviceObject, ...session }) => {
        const far = ownerOf(session.address);

        if (far && far !== deviceObject) {
            const back = all.some((other) => other.deviceObject === far && ownerOf(other.address) === deviceObject);
            return { ...session, far: far.name, ...(back ? {} : { oneSided: true as const }) };
        }

        return { ...session, ...(session.remoteAs ? { far: `AS${session.remoteAs}` } : {}) };
    });
}

function cablesOf(devices: readonly Device[]): Cable[] {
    const byName = new Map(devices.map((device) => [device.name, device]));
    const drawn = new Set<string>();
    const cables: Cable[] = [];

    const vlansOf = (device: Device, portName: string) => {
        const port = device.ports?.[portName];
        const lag = port?.lag ? device.interfaces?.[port.lag] : undefined;
        const carrier = lag?.type === "lag" ? lag : port;
        const names = [carrier?.access_vlan, carrier?.native_vlan, ...(carrier?.trunk_vlans ?? [])].filter((name) => name !== undefined);

        return [...new Set(names)].map((name) => `${name} (${device.vlans?.[name]?.id ?? "?"})`);
    };

    for (const device of devices) {
        for (const [portName, port] of Object.entries(device.ports ?? {})) {
            const link = port?.link;
            if (!port || !link) continue;

            const here = `${device.name} ${portName}`;
            const there = `${link.device} ${link.port}`;
            if (drawn.has(`${there}|${here}`)) continue;
            drawn.add(`${here}|${there}`);

            const farPort = byName.get(link.device)?.ports?.[link.port];
            const linksBack = farPort?.link?.device === device.name && farPort.link.port === portName;

            cables.push({
                device: device.name,
                port: portName,
                farDevice: link.device,
                farPort: link.port,
                ...(port.lag ? { lag: port.lag } : {}),
                ...(farPort?.lag ? { farLag: farPort.lag } : {}),
                ...(port.description ? { description: port.description } : {}),
                vlans: vlansOf(device, portName),
                ...(linksBack ? {} : { oneSided: true as const }),
            });
        }
    }

    return cables;
}

/** The directory Circuit is installed in: the nearest one up with its package.json. The schema's sources ship with it, in src/schema. */
function packageRoot(): string | undefined {
    let directory = dirname(fileURLToPath(import.meta.url));

    while (true) {
        const manifest = join(directory, "package.json");
        if (existsSync(manifest) && JSON.parse(readFileSync(manifest, "utf8")).name === "@takodotid/circuit") return directory;

        const parent = dirname(directory);
        if (parent === directory) return undefined;
        directory = parent;
    }
}

/** The schema's descriptions, or none when its sources cannot be found. */
function schemaDocs(): Record<string, TypeDocs> {
    const root = packageRoot();
    if (!root) return {};

    const sources = SCHEMA_FILES.map(([file]) => readFileSync(join(root, "src", "schema", file), "utf8"));
    const docs: Record<string, TypeDocs> = {};

    for (const type of schemaTypes(sources).flat()) {
        docs[type.name] = {
            description: type.description,
            includes: (type.includes ?? []).map((name) => name.replace(/<.*$/, "")),
            fields: Object.fromEntries(
                type.fields.map((field) => [field.path.replace(/\?$/, ""), { type: field.type, description: field.description }])
            ),
        };
    }

    return docs;
}

/** Everything studio shows. `graph` comes ready from the caller, which also knows each device's snapshot; `render` gives what a device would run. */
export function studioData(devices: readonly Device[], graph: Annotated, render: (device: Device) => string): StudioData {
    const owners = new Map<string, Holder>();
    for (const holder of holdersOf(devices)) {
        const key = keyOf(host(holder.address))!;
        if (!owners.has(key)) owners.set(key, holder);
    }

    const attempt = <T>(work: () => T, otherwise: (error: Error) => T) => {
        try {
            return work();
        } catch (error) {
            return otherwise(error as Error);
        }
    };

    return {
        graph,
        devices,
        ports: Object.fromEntries(
            devices.map((device) => [
                device.name,
                attempt(
                    () => portsOf(device.platform, device.model),
                    () => []
                ),
            ])
        ),
        rendered: Object.fromEntries(
            devices.map((device) => [
                device.name,
                attempt(
                    () => render(device),
                    (error) => `Cannot be rendered: ${error.message}`
                ),
            ])
        ),
        addresses: addressesOf(devices),
        sessions: sessionsOf(devices, owners),
        cables: cablesOf(devices),
        docs: schemaDocs(),
    };
}
