// `circuit sync librenms`: every device of the project is monitored in LibreNMS, under its name, polled with the SNMP credentials of its `monitoring.snmp`, at its location, and in a static group for its site. A device or group LibreNMS holds that the project doesn't is listed, never deleted.
//
// Written against LibreNMS's API v0 as LibreNMS 26.10 serves it: a device's name is its `display_template`, which LibreNMS 26.5 and later take.

import type { Device } from "../model";
import type { SyncChange, SyncNetwork, SyncPlan, SyncTarget } from "./sync";

/** A device as LibreNMS lists it, with the fields Circuit compares. */
type Monitored = {
    device_id: number | string;
    hostname: string;
    display?: string | null;
    location?: string | null;
    [field: string]: unknown;
};

/** A device of the project, with the network it is in, for its secrets. */
type Member = { device: Device; network: SyncNetwork; host: string };

/** A device to add. */
type Addition = { member: Member; fields: Record<string, string> };

/** A device LibreNMS monitors whose settings differ from the project. */
type Change = { member: Member; id: number; fields: Record<string, string> };

/** A device group for one site, to make or whose devices change. */
type Group = { name: string; create: boolean; add: Member[]; remove: Member[] };

/** What `circuit sync librenms` would do. */
export type LibreNmsPlan = SyncPlan & {
    additions: Addition[];
    updates: Change[];
    groups: Group[];
    /** LibreNMS's id for each device it monitors, by hostname. */
    ids: ReadonlyMap<string, number>;
};

export class LibreNms implements SyncTarget<LibreNmsPlan> {
    /** LibreNMS's names for the algorithms. */
    private static readonly AUTH = { sha1: "SHA", sha256: "SHA-256" } as const;
    private static readonly PRIVACY = { aes128: "AES", des: "DES" } as const;

    /** Fields that hold a secret: compared, never printed. */
    private static readonly SECRET_FIELDS = new Set(["authpass", "cryptopass", "community"]);

    readonly name = "LibreNMS";
    readonly heading = "LibreNMS";
    readonly where: string;

    private readonly base: string;
    private readonly headers: Record<string, string>;
    private readonly members: Member[];
    private readonly notes: string[] = [];

    /** `networks` all name the same LibreNMS; the first one's token is used. */
    constructor(networks: readonly SyncNetwork[]) {
        const [first] = networks;
        const settings = first?.integrations.librenms;
        if (!first || !settings) throw new Error("No network sets integrations.librenms.");

        const url = settings.url.replace(/\/+$/, "");
        this.where = `LibreNMS at ${url}`;
        this.base = `${url}/api/v0`;
        // The header every version of API v0 takes.
        this.headers = { "X-Auth-Token": first.reveal(settings.api_token), "Content-Type": "application/json" };

        this.members = [];
        for (const network of networks) {
            for (const device of network.devices) {
                if (device.connection.host) this.members.push({ device, network, host: device.connection.host });
                else this.notes.push(`${device.name} has no connection.host, so LibreNMS has nothing to poll.`);
            }
        }
    }

    /** Compare the project with what LibreNMS monitors. A device is known to LibreNMS by its management address. */
    async plan(): Promise<LibreNmsPlan> {
        const listed = await this.call<{ devices?: Monitored[] }>("GET", "devices?type=all");
        const devices = listed.devices ?? [];
        const monitored = new Map(devices.map((device) => [device.hostname, device]));
        const ids = new Map(devices.map((device) => [device.hostname, Number(device.device_id)]));
        const leftAlone: string[] = [];

        const additions: Addition[] = [];
        const updates: Change[] = [];
        const changes: SyncChange[] = [];

        for (const member of this.members) {
            const current = monitored.get(member.host);
            const snmp = member.device.monitoring?.snmp;

            if (!current) {
                if (!snmp) {
                    leftAlone.push(`${member.device.name} has no monitoring.snmp, so LibreNMS can't poll it.`);
                    continue;
                }

                const credentials = this.credentials(member) ?? {};
                const fields = {
                    hostname: member.host,
                    display_template: member.device.name,
                    ...credentials,
                    ...(snmp.location ? { location: snmp.location } : {}),
                };
                additions.push({ member, fields });
                changes.push({ sign: "+", what: `${member.device.name}, ${member.host}, ${LibreNms.describe(credentials)}`, details: [] });
                continue;
            }

            const change = this.changeOf(member, current);
            if (change) {
                updates.push(change);
                changes.push({
                    sign: "~",
                    what: member.device.name,
                    details: Object.entries(change.fields).map(([field, value]) =>
                        LibreNms.SECRET_FIELDS.has(field)
                            ? `${field}: differs (not shown)`
                            : `${field}: ${JSON.stringify(current[field] ?? null)} to ${JSON.stringify(value)}`
                    ),
                });
            }
        }

        const ours = new Set(this.members.map((member) => member.host));
        for (const hostname of [...monitored.keys()].filter((host) => !ours.has(host)).sort())
            leftAlone.push(`LibreNMS monitors ${hostname}, which no device in the project has. Remove it there by hand if it is gone.`);

        const polled = this.members.filter(
            (member) => monitored.has(member.host) || additions.some((addition) => addition.member === member)
        );
        const groups = await this.groupsOf(polled, ids, leftAlone);

        for (const group of groups) {
            const names = (members: Member[]) => members.map((member) => member.device.name).join(", ");
            if (group.create)
                changes.push({ sign: "+", what: `group ${group.name} with ${names(group.add) || "no device yet"}`, details: [] });
            else
                changes.push({
                    sign: "~",
                    what: `group ${group.name}`,
                    details: [
                        ...(group.add.length ? [`add ${names(group.add)}`] : []),
                        ...(group.remove.length ? [`remove ${names(group.remove)}`] : []),
                    ],
                });
        }

        return { changes, summary: [], leftAlone: [...leftAlone, ...this.notes], additions, updates, groups, ids };
    }

    /** Add each device, change each that differs, then make and fill the site groups. */
    async send(plan: LibreNmsPlan): Promise<void> {
        const ids = new Map(plan.ids);

        for (const { member, fields } of plan.additions) {
            const answer = await this.call<{ devices?: Monitored[] }>("POST", "devices", fields);
            const added = answer.devices?.[0];
            if (added) ids.set(member.host, Number(added.device_id));
        }

        for (const change of plan.updates) {
            const fields = Object.keys(change.fields);
            await this.call("PATCH", `devices/${change.id}`, { field: fields, data: fields.map((field) => change.fields[field]) });
        }

        // A device LibreNMS gave no id for is left for the next run.
        const idsOf = (members: readonly Member[]) => members.flatMap((member) => ids.get(member.host) ?? []);

        for (const group of plan.groups) {
            const path = `devicegroups/${encodeURIComponent(group.name)}`;

            if (group.create) {
                await this.call("POST", "devicegroups", {
                    name: group.name,
                    desc: `The devices at ${group.name}, kept by Circuit`,
                    type: "static",
                    devices: idsOf(group.add),
                });
                continue;
            }

            if (group.add.length) await this.call("POST", `${path}/devices`, { devices: idsOf(group.add) });
            if (group.remove.length) await this.call("DELETE", `${path}/devices`, { devices: idsOf(group.remove) });
        }
    }

    /** What differs between a device's file and LibreNMS's record of it: its name, SNMP credentials and location. */
    private changeOf(member: Member, current: Monitored): Change | undefined {
        let fields: Record<string, string> = {};

        if (current.display !== member.device.name) fields.display_template = member.device.name;

        const credentials = this.credentials(member);
        if (credentials && Object.entries(credentials).some(([field, value]) => String(current[field] ?? "") !== value))
            fields = { ...fields, ...credentials };

        // LibreNMS reads the location from the device too; setting it now shows it before the next poll.
        const location = member.device.monitoring?.snmp?.location;
        if (location && current.location !== location) fields.location = location;

        return Object.keys(fields).length ? { member, id: Number(current.device_id), fields } : undefined;
    }

    /** A static group for each site, with the devices at it. Only groups named after a site are read or changed. */
    private async groupsOf(members: readonly Member[], ids: ReadonlyMap<string, number>, leftAlone: string[]): Promise<Group[]> {
        if (!members.length) return [];

        const existing =
            (await this.call<{ groups?: { name: string; type: string }[] }>("GET", "devicegroups", undefined, true)).groups ?? [];
        const sites = [...new Set(members.map((member) => member.device.site))].sort();
        const ours = new Set(members.flatMap((member) => ids.get(member.host) ?? []));
        const groups: Group[] = [];

        for (const site of sites) {
            const atSite = members.filter((member) => member.device.site === site);
            const found = existing.find((group) => group.name === site);

            if (!found) {
                groups.push({ name: site, create: true, add: atSite, remove: [] });
                continue;
            }

            if (found.type !== "static") {
                leftAlone.push(`group ${site} is a ${found.type} group in LibreNMS, so Circuit can't fill it, and leaves it as it is.`);
                continue;
            }

            const listed = await this.call<{ devices?: { device_id: number | string }[] }>(
                "GET",
                `devicegroups/${encodeURIComponent(site)}`,
                undefined,
                true
            );
            const memberIds = new Set((listed.devices ?? []).map((device) => Number(device.device_id)));
            const isMember = (member: Member) => memberIds.has(ids.get(member.host) ?? -1);

            const others = [...memberIds].filter((id) => !ours.has(id)).length;
            if (others) leftAlone.push(`group ${site} also holds ${others} device(s) not in the project; they stay.`);

            const add = atSite.filter((member) => !isMember(member));
            const remove = members.filter((member) => member.device.site !== site && isMember(member));
            if (add.length || remove.length) groups.push({ name: site, create: false, add, remove });
        }

        return groups;
    }

    /** One request. LibreNMS answers a list with nothing in it with 404, so `emptyOn404` reads that as an empty answer. */
    private async call<T>(method: "GET" | "POST" | "PATCH" | "DELETE", path: string, body?: unknown, emptyOn404 = false): Promise<T> {
        const response = await fetch(`${this.base}/${path}`, {
            method,
            headers: this.headers,
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            signal: AbortSignal.timeout(60_000),
        });

        if (response.status === 404 && emptyOn404) return {} as T;

        const answer = (await response.json().catch(() => ({}))) as T & { status?: string; message?: string };
        if (!response.ok || answer.status === "error")
            throw new Error(`LibreNMS refused ${method} ${path}: ${answer.message ?? response.status}`);

        return answer;
    }

    /** How LibreNMS polls a device: its first SNMP version 3 user, or else its version 2c community. */
    private credentials(member: Member): Record<string, string> | undefined {
        const snmp = member.device.monitoring?.snmp;
        const [name, user] = Object.entries(snmp?.users ?? {})[0] ?? [];

        if (name && user) {
            return {
                snmpver: "v3",
                authlevel: "authPriv",
                authname: name,
                authpass: member.network.reveal(user.auth_password),
                authalgo: LibreNms.AUTH[user.auth],
                cryptopass: member.network.reveal(user.privacy_password),
                cryptoalgo: LibreNms.PRIVACY[user.privacy],
            };
        }

        if (snmp?.community) return { snmpver: "v2c", community: member.network.reveal(snmp.community) };
        return undefined;
    }

    /** How a device is polled, without a secret: `SNMP v3 user monitor` or `SNMP v2c`. */
    private static describe(credentials: Record<string, string>): string {
        if (credentials.snmpver === "v3") return `SNMP v3 user ${credentials.authname}`;
        return credentials.snmpver === "v2c" ? "SNMP v2c" : "no SNMP credentials";
    }
}
