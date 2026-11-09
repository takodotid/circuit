// `circuit sync peeringdb`: keeps a network's exchange presence at PeeringDB in step with the project. Each port or interface whose `exchange` names a `peeringdb_ixlan` is one record (a `netixlan`).
//
// It reads PeeringDB's public API, which needs no key, and sends with the network's API key. Only global addresses are published: an exchange reached over a tunnel often lands on private or shared space, and publishing it would point others at a dead end. A record the project doesn't hold is listed, never deleted, and `operational` is never changed: leaving an exchange is decided outside the project.

import { Address } from "../core/address";
import { Topology } from "../core/topology";
import type { Device, Routed } from "../model";
import type { SyncChange, SyncNetwork, SyncPlan, SyncTarget } from "./sync";

/** A network's presence at one exchange LAN, as PeeringDB holds it. */
type NetIxLan = {
    id: number;
    net_id: number;
    ixlan_id: number;
    name: string;
    speed: number;
    ipaddr4: string | null;
    ipaddr6: string | null;
    is_rs_peer: boolean;
    operational: boolean;
};

/** One record as the project describes it. */
type Wanted = {
    /** The device and its port or interface, for what is printed. */
    where: string;
    name: string;
    ixlan_id: number;
    speed: number;
    ipaddr4: string | null;
    ipaddr6: string | null;
    is_rs_peer: boolean;
};

/** A record to send: `id` when it exists and is changed in place. */
type Send = { what: string; id?: number; body: Record<string, unknown> };

/** What `circuit sync peeringdb` would do. */
export type PeeringDbPlan = SyncPlan & { sends: Send[] };

export class PeeringDb implements SyncTarget<PeeringDbPlan> {
    static readonly API = "https://www.peeringdb.com/api";

    /** Whether an address may be published: a global one, which another network can reach. A test swaps it, to publish documentation addresses. */
    static publishable: (address: string) => boolean = Address.isGlobal;

    readonly name = "PeeringDB";
    readonly heading: string;
    readonly where: string;

    private readonly asn: number;
    private readonly networks: readonly SyncNetwork[];

    /** `networks` all run the same AS; the first one's key sends. */
    constructor(networks: readonly SyncNetwork[]) {
        const [first] = networks;
        if (!first?.integrations.peeringdb) throw new Error("No network sets integrations.peeringdb.");
        if (first.asn === undefined) throw new Error(`${first.name}: integrations.peeringdb needs asn in circuit.ts.`);

        this.asn = first.asn;
        this.networks = networks;
        this.heading = `PeeringDB (AS${this.asn})`;
        this.where = `PeeringDB for AS${this.asn}`;
    }

    /** What would change at PeeringDB. Reads the public API; needs no key. */
    async plan(): Promise<PeeringDbPlan> {
        const existing = await this.read<NetIxLan>(`netixlan?asn=${this.asn}`);
        const leftAlone: string[] = [];
        const desired = this.wanted(leftAlone);

        const taken = new Set<number>();
        const sends: Send[] = [];
        const changes: SyncChange[] = [];
        let netId = existing[0]?.net_id;

        for (const record of desired) {
            const sameLan = existing.filter((candidate) => candidate.ixlan_id === record.ixlan_id && !taken.has(candidate.id));
            // Two routers at one exchange are two records on one LAN: each is matched by its address first.
            const current =
                sameLan.find(
                    (candidate) =>
                        (record.ipaddr4 !== null && PeeringDb.same(candidate.ipaddr4, record.ipaddr4)) ||
                        (record.ipaddr6 !== null && PeeringDb.same(candidate.ipaddr6, record.ipaddr6))
                ) ?? sameLan[0];
            if (current) taken.add(current.id);

            // PeeringDB takes no presence without an address, and Circuit never empties one it holds.
            if (record.ipaddr4 === null && record.ipaddr6 === null) {
                leftAlone.push(`${record.where}: ${record.name} has no global address, so it is not sent to PeeringDB.`);
                continue;
            }

            const body: Record<string, unknown> = {
                ixlan_id: record.ixlan_id,
                asn: this.asn,
                speed: record.speed,
                ipaddr4: record.ipaddr4,
                ipaddr6: record.ipaddr6,
                is_rs_peer: record.is_rs_peer,
                operational: current?.operational ?? true,
            };

            if (!current) {
                // The network's record at PeeringDB, which every presence belongs to.
                netId ??= (await this.read<{ id: number }>(`net?asn=${this.asn}`))[0]?.id;
                if (netId === undefined)
                    throw new Error(`PeeringDB has no network record for AS${this.asn}. Make it at peeringdb.com first.`);

                const what = `${record.name}: ${record.speed} Mbit/s, route server ${record.is_rs_peer ? "yes" : "no"}, ${PeeringDb.addresses(record)}`;
                sends.push({ what, body: { net_id: netId, ...body } });
                changes.push({ sign: "+", what, details: [] });
                continue;
            }

            const details = [
                ...PeeringDb.differs("ipaddr4", current.ipaddr4, record.ipaddr4),
                ...PeeringDb.differs("ipaddr6", current.ipaddr6, record.ipaddr6),
                ...(current.speed !== record.speed ? [`speed: ${current.speed} to ${record.speed} Mbit/s`] : []),
                ...(current.is_rs_peer !== record.is_rs_peer
                    ? [`route server: ${current.is_rs_peer ? "yes" : "no"} to ${record.is_rs_peer ? "yes" : "no"}`]
                    : []),
            ];
            if (!details.length) continue;

            sends.push({ what: record.name, id: current.id, body: { net_id: current.net_id, ...body } });
            changes.push({ sign: "~", what: `${record.name} (${record.where})`, details });
        }

        for (const record of existing.filter((candidate) => !taken.has(candidate.id)))
            leftAlone.push(
                `${record.name} (${PeeringDb.addresses(record)}) is on PeeringDB but not in the project. Remove it there by hand if you left.`
            );

        return { changes, summary: [], leftAlone, sends };
    }

    /** Send the changes, with the API key of the first network. */
    async send(plan: PeeringDbPlan): Promise<void> {
        const [first] = this.networks;
        const key = first!.reveal(first!.integrations.peeringdb!.api_key);

        for (const change of plan.sends) {
            const response = await fetch(`${PeeringDb.API}/netixlan${change.id ? `/${change.id}` : ""}`, {
                method: change.id ? "PUT" : "POST",
                headers: { Authorization: `Api-Key ${key}`, "Content-Type": "application/json", Accept: "application/json" },
                body: JSON.stringify(change.body),
                signal: AbortSignal.timeout(30_000),
            });

            if (!response.ok) {
                const reason = (await response.text()).slice(0, 300);
                throw new Error(`${change.what}: PeeringDB answered ${response.status} ${reason}`);
            }
        }
    }

    /** One list from PeeringDB's public API. */
    private async read<T>(query: string): Promise<T[]> {
        const response = await fetch(`${PeeringDb.API}/${query}`, {
            headers: { Accept: "application/json" },
            signal: AbortSignal.timeout(30_000),
        });
        if (!response.ok) throw new Error(`PeeringDB answered ${response.status} to ${query}`);

        return ((await response.json()) as { data?: T[] }).data ?? [];
    }

    /** Every exchange presence the project writes with a PeeringDB exchange LAN. What is not published is listed, with why. */
    private wanted(leftAlone: string[]): Wanted[] {
        const records: Wanted[] = [];

        for (const network of this.networks) {
            for (const device of network.devices) {
                for (const [name, settings] of Topology.routedOf(device)) {
                    const exchange = settings.exchange;
                    if (!exchange) continue;

                    const where = `${device.name} ${name}`;
                    if (exchange.peeringdb_ixlan === undefined) {
                        leftAlone.push(`${where}: ${exchange.name} has no exchange.peeringdb_ixlan, so it is not on PeeringDB.`);
                        continue;
                    }

                    const hosts = PeeringDb.addressesOf(settings).map(Address.host);
                    for (const address of hosts.filter((host) => !PeeringDb.publishable(host)))
                        leftAlone.push(`${where}: ${address} is not a global address, so it is not published.`);

                    const published = hosts.filter((host) => PeeringDb.publishable(host));
                    records.push({
                        where,
                        name: exchange.name,
                        ixlan_id: exchange.peeringdb_ixlan,
                        speed: exchange.speed,
                        ipaddr4: published.find((address) => Address.family(address) === "ipv4") ?? null,
                        ipaddr6: published.find((address) => Address.family(address) === "ipv6") ?? null,
                        is_rs_peer: PeeringDb.peersWithRouteServer(device, settings),
                    });
                }
            }
        }

        return records;
    }

    private static addressesOf(settings: Routed): string[] {
        return (settings.addresses ?? []).map((entry) => (typeof entry === "string" ? entry : entry.address));
    }

    /** Whether the device has a BGP neighbor with the role `rs`, itself or from its group, on this interface's subnets. */
    private static peersWithRouteServer(device: Device, settings: Routed): boolean {
        const bgp = device.routing?.bgp;
        const subnets = PeeringDb.addressesOf(settings).filter(Address.isCidr);

        return Object.values(bgp?.neighbors ?? {}).some((neighbor) => {
            if (!neighbor) return false;
            const group = neighbor.neighbor_group ? bgp?.neighbor_groups?.[neighbor.neighbor_group] : undefined;
            const role = neighbor.role ?? group?.role;
            return role === "rs" && subnets.some((subnet) => Address.contains(Address.prefixOf(subnet), neighbor.address));
        });
    }

    /** Two addresses as one, in any spelling. */
    private static same(a: string | null, b: string | null): boolean {
        return (a === null ? null : Address.canonical(a)) === (b === null ? null : Address.canonical(b));
    }

    private static differs(field: string, before: string | null, after: string | null): string[] {
        return PeeringDb.same(before, after) ? [] : [`${field}: ${before ?? "none"} to ${after ?? "none"}`];
    }

    private static addresses(record: { ipaddr4: string | null; ipaddr6: string | null }): string {
        return [record.ipaddr4, record.ipaddr6].filter(Boolean).join(", ") || "no address";
    }
}
