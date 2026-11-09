// `circuit sync netbox`: keeps NetBox in step with the project, one way: Circuit writes, NetBox shows. Each device goes in with its site, role, model and platform, every port of its model, its interfaces, VLANs, VRFs and addresses, and a cable for each `link`.
//
// Circuit tags what it makes `circuit`, and changes or deletes only objects with that tag. An object NetBox already holds without it, such as a site the team made, is used as it is, never changed, and listed under Left alone. Networks that name the same NetBox are planned together, so one never deletes what the other made.

import { Address } from "../core/address";
import { AddressSpace } from "../core/address-space";
import { type Holder, Topology } from "../core/topology";
import type { Device, InterfaceKind, Port, Switched } from "../model";
import { Platforms } from "../platforms";
import { Catalog, type PlatformName } from "../platforms/catalog";
import { Derive } from "../platforms/derive";
import type { SyncChange, SyncNetwork, SyncPlan, SyncTarget } from "./sync";

/** NetBox's JSON, as it answers. Loose, since every kind of object has fields of its own. */
type Json = { [field: string]: any };

/** Each kind of object Circuit writes, in the order they are made: each refers only to kinds before it, or waits for the next round. */
export type NetBoxKind =
    | "tag"
    | "site"
    | "manufacturer"
    | "platform"
    | "device-type"
    | "role"
    | "vrf"
    | "vlan"
    | "device"
    | "interface"
    | "prefix"
    | "ip-range"
    | "ip"
    | "cable";

/** One object to make, change or delete. */
export type NetBoxChange = {
    kind: NetBoxKind;
    /** Where NetBox keeps it, such as `dcim/devices`. */
    path: string;
    /** How Circuit knows it, built from its own fields, such as `edge-01/sfp28-1` for an interface. */
    key: string;
    /** What is sent. References to other objects are filled in with their ids when sent. */
    fields: Record<string, unknown>;
    /** NetBox's id, for an object that exists. */
    id?: number;
    /** For a change, each field that differs, as `field: before to after`. */
    diff: string[];
};

/** What `circuit sync netbox` would do. */
export type NetBoxPlan = SyncPlan & {
    creates: NetBoxChange[];
    updates: NetBoxChange[];
    deletes: NetBoxChange[];
};

/** Another object, by kind and key, sent as its id once NetBox has it. */
class NetBoxRef {
    constructor(
        readonly kind: NetBoxKind,
        readonly key: string
    ) {}
}

export class NetBox implements SyncTarget<NetBoxPlan> {
    /** The tag on everything Circuit makes. */
    static readonly TAG = "circuit";

    /** How many rounds `send` takes at most: a field that refers to an object made in the same round, such as a device's primary address, is set in the next. */
    private static readonly ROUNDS = 3;

    /** Where each kind is kept, and how an object NetBox answers with is known by its key. */
    private static readonly KINDS: Record<NetBoxKind, { path: string; key: (object: Json) => string }> = {
        tag: { path: "extras/tags", key: (o) => o.slug },
        site: { path: "dcim/sites", key: (o) => o.name },
        manufacturer: { path: "dcim/manufacturers", key: (o) => o.slug },
        platform: { path: "dcim/platforms", key: (o) => o.slug },
        "device-type": { path: "dcim/device-types", key: (o) => `${o.manufacturer?.slug}/${o.slug}` },
        role: { path: "dcim/device-roles", key: (o) => o.name },
        vrf: { path: "ipam/vrfs", key: (o) => o.name },
        vlan: { path: "ipam/vlans", key: (o) => `${o.site?.name}/${o.vid}` },
        device: { path: "dcim/devices", key: (o) => o.name },
        interface: { path: "dcim/interfaces", key: (o) => `${o.device?.name}/${o.name}` },
        prefix: { path: "ipam/prefixes", key: (o) => NetBox.prefixKey(o.prefix, o.vrf?.name) },
        "ip-range": {
            path: "ipam/ip-ranges",
            key: (o) => `${Address.canonical(o.start_address)}-${Address.canonical(o.end_address)}`,
        },
        ip: { path: "ipam/ip-addresses", key: (o) => `${Address.canonical(o.address)}${NetBox.assignedTo(o)}` },
        cable: {
            path: "dcim/cables",
            key: (o) => [...o.a_terminations, ...o.b_terminations].map(NetBox.endOf).sort().join(" to "),
        },
    };

    private static readonly ORDER = Object.keys(NetBox.KINDS) as NetBoxKind[];

    /** Fields sent when an object is made and never compared after: its tags, which people may add to, and a cable's ends, which its key already holds. */
    private static readonly CREATE_ONLY = new Set(["tags", "a_terminations", "b_terminations"]);

    /** Fields that hold an address, compared in one spelling. */
    private static readonly ADDRESS_FIELDS = new Set(["address", "prefix", "start_address", "end_address"]);

    /** Who makes the hardware each platform runs on: the project names the platform, not the vendor. */
    private static readonly VENDORS: Record<PlatformName, string> = {
        routeros: "MikroTik",
        vrp: "Huawei",
        "raisecom-ros": "Raisecom",
        junos: "Juniper",
        fortios: "Fortinet",
    };

    /** NetBox's type for a port, by the speed in Circuit's port name. */
    private static readonly PORT_TYPES: Record<string, string> = {
        "100g": "100gbase-x-qsfp28",
        "50g": "50gbase-x-sfp56",
        "40g": "40gbase-x-qsfpp",
        "25g": "25gbase-x-sfp28",
        "10g": "10gbase-x-sfpp",
        "2.5g": "2.5gbase-t",
        "1g": "1000base-t",
        "100m": "100base-tx",
    };

    /** NetBox's type for every interface that is not a port. */
    private static readonly INTERFACE_TYPES: Record<InterfaceKind, string> = {
        lag: "lag",
        bridge: "bridge",
        vlan_interface: "virtual",
        loopback: "virtual",
        gre: "virtual",
        vxlan: "virtual",
        wireguard: "virtual",
        eoip: "virtual",
    };

    /** A port's fixed speed in kbit/s, as NetBox counts it. */
    private static readonly SPEEDS: Record<NonNullable<Port["speed"]>, number> = {
        "100m": 100_000,
        "1g": 1_000_000,
        "10g": 10_000_000,
        "25g": 25_000_000,
        "40g": 40_000_000,
        "50g": 50_000_000,
        "100g": 100_000_000,
    };

    readonly name = "NetBox";
    readonly heading = "NetBox";
    readonly where: string;

    private readonly base: string;
    private readonly headers: Record<string, string>;
    private readonly devices: Device[];
    /** Every object the project asks for, by kind and key. */
    private readonly wanted = new Map<NetBoxKind, Map<string, Record<string, unknown>>>(NetBox.ORDER.map((kind) => [kind, new Map()]));
    /** What NetBox can't show, or Circuit won't make, each with its reason. */
    private readonly notes: string[] = [];
    /** NetBox's id for each object it holds, by kind and key. */
    private readonly ids = new Map<string, number>();

    /** `networks` all name the same NetBox; the first one's token is used. */
    constructor(networks: readonly SyncNetwork[]) {
        const [first] = networks;
        const settings = first?.integrations.netbox;
        if (!first || !settings) throw new Error("No network sets integrations.netbox.");

        const url = settings.url.replace(/\/+$/, "");
        this.where = `NetBox at ${url}`;
        this.base = `${url}/api`;

        // A version 2 token, NetBox 4.5 and later, starts with `nbt_` and goes after `Bearer`; an older one after `Token`.
        const token = first.reveal(settings.api_token);
        this.headers = {
            Authorization: `${token.startsWith("nbt_") ? "Bearer" : "Token"} ${token}`,
            "Content-Type": "application/json",
            Accept: "application/json",
        };

        this.devices = networks.flatMap((network) => [...network.devices]);
        const sites = Object.assign({}, ...networks.map((network) => network.sites)) as SyncNetwork["sites"];

        this.want("tag", NetBox.TAG, { name: NetBox.TAG, slug: NetBox.TAG, description: "Made by Circuit, which changes and deletes it" });

        const holders = Topology.holders(this.devices);
        for (const device of this.devices) this.wantDevice(device, sites[device.site]?.description, holders);

        this.wantPrefixes(holders);
        this.wantUnassigned(holders);

        const sessions = this.devices.reduce((count, device) => count + Object.keys(device.routing?.bgp?.neighbors ?? {}).length, 0);
        if (sessions) this.notes.push(`BGP sessions (${sessions}): NetBox has no place for them without a plugin.`);
    }

    /** Compare the project with what NetBox holds. Reads NetBox only. */
    async plan(): Promise<NetBoxPlan> {
        const creates: NetBoxChange[] = [];
        const updates: NetBoxChange[] = [];
        const deletes: NetBoxChange[] = [];
        const untagged: string[] = [];
        const existing = new Map<NetBoxKind, Map<string, Json>>();

        // Every id first, so a field can refer to any kind.
        this.ids.clear();

        for (const kind of NetBox.ORDER) {
            const objects = new Map((await this.list(NetBox.KINDS[kind].path)).map((object) => [NetBox.KINDS[kind].key(object), object]));
            for (const [key, object] of objects) this.ids.set(NetBox.idKey(kind, key), object.id);

            existing.set(kind, objects);
        }

        for (const kind of NetBox.ORDER) {
            const path = NetBox.KINDS[kind].path;
            const objects = existing.get(kind)!;
            const wanted = this.wanted.get(kind)!;

            for (const [key, fields] of wanted) {
                const found = objects.get(key);

                if (!found) {
                    const tags = kind === "tag" ? {} : { tags: [new NetBoxRef("tag", NetBox.TAG)] };
                    creates.push({ kind, path, key, fields: { ...fields, ...tags }, diff: [] });
                    continue;
                }

                if (kind !== "tag" && !NetBox.isTagged(found)) {
                    untagged.push(`${path} ${key}: in NetBox without the tag ${NetBox.TAG}, so it is used as it is.`);
                    continue;
                }

                const diff = Object.entries(fields).flatMap(([field, value]) => {
                    if (NetBox.CREATE_ONLY.has(field)) return [];

                    const ours = JSON.stringify(NetBox.normalize(this.resolve(value), field));
                    const theirs = JSON.stringify(NetBox.normalize(found[field], field));
                    return ours === theirs ? [] : [`${field}: ${theirs} to ${ours}`];
                });

                if (diff.length) updates.push({ kind, path, key, fields, id: found.id, diff });
            }

            if (kind === "tag") continue;

            for (const [key, object] of objects) {
                if (!wanted.has(key) && NetBox.isTagged(object)) deletes.push({ kind, path, key, fields: {}, id: object.id, diff: [] });
            }
        }

        const changes: SyncChange[] = [
            ...creates.map((change) => ({ sign: "+" as const, what: `${change.path} ${change.key}`, details: [] })),
            ...updates.map((change) => ({ sign: "~" as const, what: `${change.path} ${change.key}`, details: change.diff })),
            ...deletes.map((change) => ({ sign: "-" as const, what: `${change.path} ${change.key}`, details: [] })),
        ];

        const summary = NetBox.ORDER.flatMap((kind) => {
            const count = (list: NetBoxChange[]) => list.filter((change) => change.kind === kind).length;
            const [made, changed, deleted] = [count(creates), count(updates), count(deletes)];
            return made || changed || deleted
                ? [`${NetBox.KINDS[kind].path}: ${made} to create, ${changed} to change, ${deleted} to delete`]
                : [];
        });

        return { changes, summary, leftAlone: [...untagged, ...this.notes], creates, updates, deletes };
    }

    /** Send the plan, then plan again and send what is left, until NetBox matches or `ROUNDS` rounds are done. */
    async send(plan: NetBoxPlan): Promise<void> {
        let left = plan;

        for (let round = 1; round <= NetBox.ROUNDS && left.changes.length; round++) {
            await this.apply(left);
            if (round < NetBox.ROUNDS) left = await this.plan();
        }
    }

    private async apply(plan: NetBoxPlan): Promise<void> {
        // Deletes go first, the last kind first, so nothing still refers to what goes.
        const deletes = [...plan.deletes].sort((a, b) => NetBox.ORDER.indexOf(b.kind) - NetBox.ORDER.indexOf(a.kind));
        for (const change of deletes) await this.call("DELETE", `${change.path}/${change.id}/`);

        for (const kind of NetBox.ORDER) {
            for (const change of plan.creates.filter((candidate) => candidate.kind === kind)) {
                const made = (await this.call("POST", `${change.path}/`, this.sendable(change.fields, false)))!;
                this.ids.set(NetBox.idKey(kind, change.key), made.id);
            }

            for (const change of plan.updates.filter((candidate) => candidate.kind === kind)) {
                await this.call("PATCH", `${change.path}/${change.id}/`, this.sendable(change.fields, true));
            }
        }
    }

    /** Ask for an object. The first to ask for a key wins; a later one only fills fields still empty. */
    private want(kind: NetBoxKind, key: string, fields: Record<string, unknown>): void {
        const known = this.wanted.get(kind)!.get(key);

        if (!known) {
            this.wanted.get(kind)!.set(key, fields);
            return;
        }

        for (const [field, value] of Object.entries(fields)) {
            if (known[field] === undefined || known[field] === null || known[field] === "") known[field] = value;
        }
    }

    /** A device, its site, VLANs, VRFs, ports, interfaces, addresses and cables. */
    private wantDevice(device: Device, siteDescription: string | undefined, holders: readonly Holder[]): void {
        const ref = (kind: NetBoxKind, key: string) => new NetBoxRef(kind, key);
        const site = device.site;
        const role = device.role;

        // `circuit validate` stops on this already; here it is only never guessed.
        if (!role) {
            this.notes.push(`${device.name} has no role, so it is not in NetBox. Write role, such as role: "Edge router".`);
            return;
        }

        let ports: string[];
        try {
            ports = Catalog.ports(device.platform, device.model);
        } catch {
            this.notes.push(`${device.name}: ${device.platform} has no model ${device.model}, so it is not in NetBox.`);
            return;
        }

        const vendor = NetBox.VENDORS[device.platform as PlatformName] ?? device.platform;
        const manufacturer = NetBox.slug(vendor);
        const deviceType = `${manufacturer}/${NetBox.slug(device.model)}`;

        this.want("site", site, { name: site, slug: NetBox.slug(site), status: "active", description: siteDescription ?? "" });
        this.want("manufacturer", manufacturer, { name: vendor, slug: manufacturer });
        this.want("platform", device.platform, {
            name: Platforms.find(device.platform)?.os.name ?? device.platform,
            slug: device.platform,
            manufacturer: ref("manufacturer", manufacturer),
        });
        this.want("device-type", deviceType, {
            manufacturer: ref("manufacturer", manufacturer),
            model: device.model,
            slug: NetBox.slug(device.model),
        });
        this.want("role", role, { name: role, slug: NetBox.slug(role) });

        for (const [name, vrf] of Object.entries(device.routing?.vrfs ?? {}))
            this.want("vrf", name, { name, description: vrf?.description ?? "" });

        for (const [name, vlan] of Object.entries(device.switching?.vlans ?? {})) {
            if (!vlan) continue;
            this.want("vlan", `${site}/${vlan.id}`, {
                site: ref("site", site),
                vid: vlan.id,
                name,
                description: vlan.description ?? "",
                status: "active",
            });
        }

        const named = (port: string) => NetBox.interfaceName(device, port);
        const interfaceRef = (name: string) => ref("interface", `${device.name}/${named(name)}`);
        const vlanRef = (name: string) => ref("vlan", `${site}/${device.switching?.vlans?.[name]?.id}`);

        // How a port, LAG or VLAN interface is switched, in NetBox's terms.
        const switching = (settings: Switched) => {
            if (settings.access_vlan) return { mode: "access", untagged_vlan: vlanRef(settings.access_vlan), tagged_vlans: [] };

            if (settings.trunk_vlans) {
                return {
                    mode: "tagged",
                    untagged_vlan: settings.native_vlan ? vlanRef(settings.native_vlan) : null,
                    tagged_vlans: settings.trunk_vlans.filter((name) => name !== settings.native_vlan).map(vlanRef),
                };
            }

            return { mode: null, untagged_vlan: null, tagged_vlans: [] };
        };

        const bridgeOf = new Map(
            Object.entries(device.interfaces?.bridge ?? {}).flatMap(([name, bridge]) =>
                (bridge?.member_interfaces ?? []).map((member) => [member, name] as const)
            )
        );

        // LAGs come first in `Derive.interfaces`, so a port made in the same round can name its LAG.
        for (const { name, kind, settings } of Derive.interfaces(device)) {
            const bridge = bridgeOf.get(name);
            const how =
                kind === "lag"
                    ? switching(settings as Switched)
                    : kind === "vlan_interface" && "vlan" in settings
                      ? switching({ access_vlan: settings.vlan })
                      : switching({});

            if (kind === "eoip" && "in_lag" in settings && settings.in_lag)
                this.notes.push(
                    `${device.name} ${name} is in LAG ${settings.in_lag}: NetBox puts no virtual interface in a LAG, so it is shown on its own.`
                );

            this.want("interface", `${device.name}/${name}`, {
                device: ref("device", device.name),
                name,
                label: "",
                type: NetBox.INTERFACE_TYPES[kind],
                enabled: true,
                description: settings.description ?? "",
                mtu: settings.mtu ?? null,
                speed: null,
                lag: null,
                bridge: bridge ? interfaceRef(bridge) : null,
                vrf: settings.vrf ? ref("vrf", settings.vrf) : null,
                ...how,
            });
        }

        // Every port of the model. One the file doesn't write is shut, as on the device.
        for (const portName of ports) {
            const port = device.interfaces?.ethernet?.[portName];

            this.want("interface", `${device.name}/${named(portName)}`, {
                device: ref("device", device.name),
                name: named(portName),
                label: portName,
                type: NetBox.PORT_TYPES[portName.split("-")[0]!] ?? "other",
                enabled: Boolean(port),
                description: port?.description ?? "",
                mtu: port?.mtu ?? null,
                speed: port?.speed ? NetBox.SPEEDS[port.speed] : null,
                lag: port?.in_lag ? interfaceRef(port.in_lag) : null,
                bridge: null,
                vrf: port?.vrf ? ref("vrf", port.vrf) : null,
                ...(port && !port.in_lag ? switching(port) : switching({})),
            });
        }

        // The addresses on them. The one Circuit reaches the device at is its primary address.
        let primary: { address: string; key: string } | undefined;

        for (const holder of holders.filter((candidate) => candidate.device === device)) {
            const address = Address.canonical(holder.address);
            const key = `${address} on ${device.name}/${named(holder.name)}`;
            const loopback = device.interfaces?.loopback?.[holder.name] !== undefined;

            this.want("ip", key, {
                address,
                status: "active",
                role: loopback ? "loopback" : null,
                vrf: holder.vrf ? ref("vrf", holder.vrf) : null,
                description: "",
                assigned_object_type: "dcim.interface",
                assigned_object_id: interfaceRef(holder.name),
            });

            const host = device.connection.host;
            if (!primary && host && Address.canonical(Address.host(holder.address)) === Address.canonical(host)) primary = { address, key };
        }

        const primaryOf = (family: "ipv4" | "ipv6") =>
            primary && Address.family(primary.address) === family ? ref("ip", primary.key) : null;

        this.want("device", device.name, {
            name: device.name,
            device_type: ref("device-type", deviceType),
            role: ref("role", role),
            platform: ref("platform", device.platform),
            site: ref("site", site),
            status: "active",
            primary_ip4: primaryOf("ipv4"),
            primary_ip6: primaryOf("ipv6"),
        });

        // A cable for each link. Both ends write it, so it is known by its two ends in order.
        for (const [portName, port] of Derive.ports(device)) {
            const link = port.link;
            if (!link) continue;

            const far = this.devices.find((candidate) => candidate.name === link.device);
            if (!far) {
                this.notes.push(
                    `${device.name} ${portName} links to ${link.device}, which is not in the networks that use this NetBox, so no cable.`
                );
                continue;
            }

            const [a, b] = [`${device.name}/${named(portName)}`, `${far.name}/${NetBox.interfaceName(far, link.port)}`].sort() as [
                string,
                string,
            ];

            if (link.through) {
                if (a.startsWith(`${device.name}/`))
                    this.notes.push(`${a} to ${b} goes through ${link.through}, so no cable: NetBox keeps a carrier's line as a circuit.`);
                continue;
            }

            const end = (key: string) => [{ object_type: "dcim.interface", object_id: ref("interface", key) }];
            this.want("cable", `${a} to ${b}`, { a_terminations: end(a), b_terminations: end(b), status: "connected" });
        }
    }

    /** A prefix for each subnet an interface is on, and a container for each prefix the network originates in BGP. */
    private wantPrefixes(holders: readonly Holder[]): void {
        for (const holder of holders) {
            const { len, family } = Address.split(holder.address);
            if (holder.peer || len === Address.bits(family) || !holder.device.role) continue;

            const prefix = Address.canonical(Address.prefixOf(holder.address));
            const site = holder.device.site;
            const settings = Derive.settings(holder.device, holder.name);
            const vlanName = holder.device.interfaces?.vlan_interface?.[holder.name]?.vlan;
            const vlanId = vlanName === undefined ? undefined : holder.device.switching?.vlans?.[vlanName]?.id;

            this.want("prefix", NetBox.prefixKey(prefix, holder.vrf), {
                prefix,
                status: "active",
                vrf: holder.vrf ? new NetBoxRef("vrf", holder.vrf) : null,
                description: settings?.description ?? "",
                vlan: vlanId === undefined ? null : new NetBoxRef("vlan", `${site}/${vlanId}`),
                scope_type: "dcim.site",
                scope_id: new NetBoxRef("site", site),
            });
        }

        for (const device of this.devices) {
            for (const originated of device.routing?.bgp?.originated_prefixes ?? []) {
                if (!Address.isCidr(originated)) continue;

                const prefix = Address.canonical(Address.prefixOf(originated));
                this.want("prefix", NetBox.prefixKey(prefix, undefined), {
                    prefix,
                    status: "container",
                    vrf: null,
                    description: "",
                    vlan: null,
                    scope_type: null,
                    scope_id: null,
                });
            }
        }
    }

    /** Addresses the project knows that sit on no interface of ours, as `circuit addresses` lists them: neighbors, next hops, reservations, VRRP, and DHCP pools as ranges. */
    private wantUnassigned(holders: readonly Holder[]): void {
        const held = new Set(holders.map((holder) => Address.canonical(Address.host(holder.address))));
        const report = AddressSpace.report(this.devices);
        const segments = [...report.spaces.flatMap((space) => space.segments), ...report.elsewhere.segments];
        const blocks = [...report.spaces.flatMap((space) => space.blocks), ...report.elsewhere.blocks];

        for (const segment of segments) {
            const length = Address.split(segment.prefix).len;

            for (const use of segment.uses) {
                const [first, last] = use.address.split("-") as [string, string | undefined];
                const common = { status: "active", description: use.what };

                if (last) {
                    const start = Address.canonical(`${first}/${length}`);
                    const end = Address.canonical(`${last}/${length}`);
                    this.want("ip-range", `${start}-${end}`, { start_address: start, end_address: end, ...common });
                    continue;
                }

                if (held.has(Address.canonical(first))) continue;

                const address = Address.canonical(`${first}/${length}`);
                this.want("ip", address, { address, ...common });
            }
        }

        // A loopback's or a point-to-point address is on an interface already; what is left is routed elsewhere, on no link of ours.
        const elsewhere = blocks.filter((block) => !held.has(Address.canonical(Address.host(block.prefix))));
        const [example] = elsewhere;
        if (example)
            this.notes.push(
                `${elsewhere.length} prefix(es) on no link of ours, such as ${example.prefix} (${example.what}): no interface of ours is on them, so they are not in NetBox.`
            );
    }

    /** A value with every reference replaced by its id, or by `<kind key>` while the object does not exist. */
    private resolve(value: unknown): unknown {
        if (value instanceof NetBoxRef) return this.ids.get(NetBox.idKey(value.kind, value.key)) ?? `<${value.kind} ${value.key}>`;
        if (Array.isArray(value)) return value.map((item) => this.resolve(item));
        if (value && typeof value === "object")
            return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, this.resolve(item)]));

        return value;
    }

    /** The fields NetBox can take now. A reference to an object not made yet waits for the next round. */
    private sendable(fields: Record<string, unknown>, update: boolean): Record<string, unknown> {
        return Object.fromEntries(
            Object.entries(fields).flatMap(([field, value]) => {
                if (update && NetBox.CREATE_ONLY.has(field)) return [];

                const resolved = this.resolve(value);
                return JSON.stringify(resolved).includes('"<') ? [] : [[field, resolved]];
            })
        );
    }

    private async call(method: "GET" | "POST" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<Json | undefined> {
        const response = await fetch(`${this.base}/${path}`, {
            method,
            headers: this.headers,
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            signal: AbortSignal.timeout(60_000),
        });

        // An object deleted with its parent, such as a device's interfaces, is already gone.
        if (response.status === 404 && method === "DELETE") return undefined;

        if (!response.ok) {
            const reason = (await response.text()).slice(0, 500);
            throw new Error(`NetBox answered ${response.status} to ${method} ${path}: ${reason}`);
        }

        return response.status === 204 ? undefined : ((await response.json()) as Json);
    }

    /** Every object of a kind, page by page. */
    private async list(path: string): Promise<Json[]> {
        const all: Json[] = [];

        for (let next: string | null = `${path}/?limit=1000`; next;) {
            const page = (await this.call("GET", next)) as { results: Json[]; next: string | null };
            all.push(...page.results);

            // The next page's link is absolute and may name another host behind a proxy, so only its path is kept.
            next = page.next ? page.next.slice(page.next.indexOf("/api/") + "/api/".length) : null;
        }

        return all;
    }

    /** NetBox's answer in the shape Circuit sends: a nested object as its id, a choice as its value, a cable end as its type and id, an address in one spelling. */
    private static normalize(value: unknown, field = ""): unknown {
        if (value === undefined || value === null || value === "") return null;

        if (Array.isArray(value)) {
            return value.map((item) => NetBox.normalize(item)).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
        }

        if (typeof value === "object") {
            const object = value as Json;
            if ("object_type" in object && "object_id" in object) return { object_type: object.object_type, object_id: object.object_id };
            if ("value" in object && "label" in object) return NetBox.normalize(object.value);
            if ("id" in object) return object.id;

            return value;
        }

        if (typeof value === "string" && NetBox.ADDRESS_FIELDS.has(field)) return Address.canonical(value);
        return value;
    }

    private static isTagged(object: Json): boolean {
        return (object.tags ?? []).some((tag: Json) => tag.slug === NetBox.TAG);
    }

    /** A port's name on the device, such as `sfp28-1` for `25g-1`, as NetBox shows it. Any other interface keeps its name from the project. */
    private static interfaceName(device: Device, name: string): string {
        if (Derive.interfaces(device).some((entry) => entry.name === name)) return name;

        try {
            return Catalog.spell(device.platform, device.model, name);
        } catch {
            return name;
        }
    }

    private static prefixKey(prefix: string, vrf: string | undefined): string {
        return `${Address.canonical(prefix)}${vrf ? ` in ${vrf}` : ""}`;
    }

    /** ` on <device>/<interface>` for an address on an interface, or nothing. */
    private static assignedTo(ip: Json): string {
        const holder = ip.assigned_object;
        return holder ? ` on ${holder.device?.name ?? holder.virtual_machine?.name}/${holder.name}` : "";
    }

    /** One end of a cable, as `<device>/<interface>`, or by its type and id when it is not an interface. */
    private static endOf(end: Json): string {
        return end.object?.device ? `${end.object.device.name}/${end.object.name}` : `${end.object_type} ${end.object_id}`;
    }

    private static idKey(kind: NetBoxKind, key: string): string {
        return `${kind} ${key}`;
    }

    /** A name as NetBox's slugs write it: `Core switch` to `core-switch`. */
    private static slug(text: string): string {
        return text
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "");
    }
}
