// Keeps LibreNMS in step with the config: every device Circuit manages is monitored there, under its name, polled with the SNMP credentials its config gives it, at the location it reports, and in a group for its site. A device LibreNMS holds that the config does not is reported, never deleted, and so is a group.
//
// Written against LibreNMS's API v0 as LibreNMS 26.10 serves it: a device's name is its `display_template`, which LibreNMS 26.5 and later take.

import type { Network } from "../core/define";
import { Secrets } from "../core/secrets";
import type { Device } from "../schema";

/** A device as LibreNMS lists it, with the fields Circuit compares. */
type Monitored = {
    device_id: number | string;
    hostname: string;
    display?: string | null;
    location?: string | null;
    [field: string]: unknown;
};

/** A device LibreNMS monitors whose settings differ from its config. */
export type LibreNmsChange = {
    device: Device;
    /** LibreNMS's id for it. */
    id: number;
    /** What differs, in words: `name`, `SNMP credentials` or `location`. Never a secret's value. */
    what: string[];
    /** What is sent: LibreNMS's field names and their values. */
    fields: Record<string, string>;
};

/** A device group for one site, to make or whose devices change. */
export type LibreNmsGroup = {
    /** The site's name, which is the group's. */
    name: string;
    /** LibreNMS has no group of this name yet. */
    create: boolean;
    /** Devices at the site that are not in the group. */
    add: Device[];
    /** Devices in the group that the config puts at another site. */
    remove: Device[];
};

/** What `librenms` would do. */
export type LibreNmsPlan = {
    /** Devices to add. */
    additions: Device[];
    /** Devices to change. */
    changes: LibreNmsChange[];
    /** Site groups to make or change. Empty when the network has no `site`. */
    groups: LibreNmsGroup[];
    /** Devices that cannot be added: their config turns SNMP off. */
    withoutSnmp: Device[];
    /** Hostnames LibreNMS holds that no device in the config has. */
    unknown: string[];
    /** Site groups LibreNMS holds as dynamic groups, which Circuit cannot fill, so leaves alone. */
    dynamicGroups: string[];
    /** LibreNMS's id for each device it monitors, by hostname. */
    ids: ReadonlyMap<string, number>;
};

export class LibreNms {
    /** LibreNMS's names for the algorithms. */
    private static readonly AUTH = { sha1: "SHA", sha256: "SHA-256" } as const;
    private static readonly PRIVACY = { aes128: "AES", des: "DES" } as const;

    /** Compare the config with what LibreNMS monitors. A device is known to LibreNMS by its management address. */
    static async plan(network: Network): Promise<LibreNmsPlan> {
        const settings = LibreNms.settingsOf(network);

        const listed = await LibreNms.call<{ devices: Monitored[] }>(settings, "GET", "devices?type=all");
        const monitored = new Map(listed.devices.map((device) => [device.hostname, device]));
        const ids = new Map(listed.devices.map((device) => [device.hostname, Number(device.device_id)]));

        // A device reached only through its console has no address to poll.
        const polled = network.devices.filter((device) => device.connection.host);
        const ours = new Set<string | undefined>(polled.map((device) => device.connection.host));
        const missing = polled.filter((device) => !monitored.has(device.connection.host!));
        const additions = missing.filter((device) => device.management?.snmp);

        const changes = polled.flatMap((device) => {
            const current = monitored.get(device.connection.host!);
            return current ? LibreNms.changeOf(device, current) : [];
        });

        const atSites = polled.filter((device) => monitored.has(device.connection.host!) || additions.includes(device));
        const { groups, dynamicGroups } = await LibreNms.groupsOf(network, settings, atSites, ids);

        return {
            additions,
            changes,
            groups,
            withoutSnmp: missing.filter((device) => !device.management?.snmp),
            unknown: [...monitored.keys()].filter((hostname) => !ours.has(hostname)).sort(),
            dynamicGroups,
            ids,
        };
    }

    /** How many changes a plan holds. */
    static count(plan: LibreNmsPlan): number {
        return plan.additions.length + plan.changes.length + plan.groups.length;
    }

    /** Add each device, change each that differs, then make and fill the site groups. */
    static async send(network: Network, plan: LibreNmsPlan): Promise<void> {
        const settings = LibreNms.settingsOf(network);
        const ids = new Map(plan.ids);

        for (const device of plan.additions) {
            const location = device.management?.snmp?.location;
            const body = {
                hostname: device.connection.host,
                display_template: device.name,
                ...LibreNms.credentials(device),
                ...(location ? { location } : {}),
            };
            const answer = await LibreNms.call<{ message?: string; devices?: Monitored[] }>(settings, "POST", "devices", body);

            const added = answer.devices?.[0];
            if (added) ids.set(device.connection.host!, Number(added.device_id));

            console.log(`  ${device.name}: ${answer.message}`);
        }

        for (const change of plan.changes) {
            const fields = Object.keys(change.fields);
            await LibreNms.call(settings, "PATCH", `devices/${change.id}`, {
                field: fields,
                data: fields.map((field) => change.fields[field]),
            });

            console.log(`  ${change.device.name}: changed its ${change.what.join(", ")}`);
        }

        // A device LibreNMS did not give an id for is left for the next run.
        const idsOf = (devices: readonly Device[]) => devices.flatMap((device) => ids.get(device.connection.host!) ?? []);

        for (const group of plan.groups) {
            const path = `devicegroups/${encodeURIComponent(group.name)}`;

            if (group.create) {
                await LibreNms.call(settings, "POST", "devicegroups", {
                    name: group.name,
                    desc: `The devices at ${group.name}, kept by Circuit`,
                    type: "static",
                    devices: idsOf(group.add),
                });
                console.log(`  made the group ${group.name}`);
                continue;
            }

            if (group.add.length) await LibreNms.call(settings, "POST", `${path}/devices`, { devices: idsOf(group.add) });
            if (group.remove.length) await LibreNms.call(settings, "DELETE", `${path}/devices`, { devices: idsOf(group.remove) });

            console.log(`  changed the group ${group.name}`);
        }
    }

    /** What differs between a device's config and LibreNMS's record of it: its name, SNMP credentials and location. */
    private static changeOf(device: Device, current: Monitored): LibreNmsChange[] {
        const what: string[] = [];
        let fields: Record<string, string> = {};

        if (current.display !== device.name) {
            what.push("name");
            fields.display_template = device.name;
        }

        const credentials = LibreNms.credentials(device);
        if (credentials && Object.entries(credentials).some(([field, value]) => String(current[field] ?? "") !== value)) {
            what.push("SNMP credentials");
            fields = { ...fields, ...credentials };
        }

        // LibreNMS reads the location from the device too; setting it now shows it before the next poll.
        const location = device.management?.snmp?.location;
        if (location && current.location !== location) {
            what.push("location");
            fields.location = location;
        }

        return what.length ? [{ device, id: Number(current.device_id), what, fields }] : [];
    }

    /** A static group for each site, with the devices at it. Only groups named after a site are read or changed. */
    private static async groupsOf(
        network: Network,
        settings: LibreNmsSettings,
        devices: readonly Device[],
        ids: ReadonlyMap<string, number>
    ): Promise<{ groups: LibreNmsGroup[]; dynamicGroups: string[] }> {
        const siteOf = network.site;
        if (!siteOf) return { groups: [], dynamicGroups: [] };

        const existing =
            (await LibreNms.call<{ groups?: { name: string; type: string }[] }>(settings, "GET", "devicegroups", undefined, true)).groups ??
            [];
        const sites = [...new Set(devices.map(siteOf))].sort();

        const groups: LibreNmsGroup[] = [];
        const dynamicGroups: string[] = [];

        for (const site of sites) {
            const atSite = devices.filter((device) => siteOf(device) === site);
            const found = existing.find((group) => group.name === site);

            if (!found) {
                groups.push({ name: site, create: true, add: atSite, remove: [] });
                continue;
            }

            if (found.type !== "static") {
                dynamicGroups.push(site);
                continue;
            }

            const listed = await LibreNms.call<{ devices?: { device_id: number | string }[] }>(
                settings,
                "GET",
                `devicegroups/${encodeURIComponent(site)}`,
                undefined,
                true
            );
            const members = new Set((listed.devices ?? []).map((member) => Number(member.device_id)));
            const isMember = (device: Device) => members.has(ids.get(device.connection.host!) ?? -1);

            const add = atSite.filter((device) => !isMember(device));
            const remove = devices.filter((device) => siteOf(device) !== site && isMember(device));
            if (add.length || remove.length) groups.push({ name: site, create: false, add, remove });
        }

        return { groups, dynamicGroups };
    }

    private static settingsOf(network: Network): LibreNmsSettings {
        if (!network.librenms) throw new Error("the network has no librenms settings");

        return {
            base: `${network.librenms.url.replace(/\/+$/, "")}/api/v0`,
            // The header every version of API v0 accepts.
            headers: { "X-Auth-Token": Secrets.reveal(network.librenms.api_token), "Content-Type": "application/json" },
        };
    }

    /** One request. LibreNMS answers a list with nothing in it with 404, so `emptyOn404` reads that as an empty answer. */
    private static async call<T>(
        settings: LibreNmsSettings,
        method: "GET" | "POST" | "PATCH" | "DELETE",
        path: string,
        body?: unknown,
        emptyOn404 = false
    ): Promise<T> {
        const response = await fetch(`${settings.base}/${path}`, {
            method,
            headers: settings.headers,
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: AbortSignal.timeout(60_000),
        });

        if (response.status === 404 && emptyOn404) return {} as T;

        const answer = (await response.json().catch(() => ({}))) as T & { status?: string; message?: string };
        if (!response.ok || answer.status === "error") {
            throw new Error(`LibreNMS refused ${method} ${path}: ${answer.message ?? response.status}`);
        }

        return answer;
    }

    /** How LibreNMS polls a device: its first SNMP version 3 user, or else its version 2c community. */
    private static credentials(device: Device): Record<string, string> | undefined {
        const snmp = device.management?.snmp;
        const [name, user] = Object.entries(snmp?.users ?? {})[0] ?? [];

        if (name && user) {
            return {
                snmpver: "v3",
                authlevel: "authPriv",
                authname: name,
                authpass: Secrets.reveal(user.auth_password),
                authalgo: LibreNms.AUTH[user.auth],
                cryptopass: Secrets.reveal(user.privacy_password),
                cryptoalgo: LibreNms.PRIVACY[user.privacy],
            };
        }

        if (snmp?.community) return { snmpver: "v2c", community: Secrets.reveal(snmp.community) };
        return undefined;
    }
}

/** Where LibreNMS's API is, and the headers every request sends. */
type LibreNmsSettings = { base: string; headers: Record<string, string> };
