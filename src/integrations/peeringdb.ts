// Keeps a network's exchange presence at PeeringDB in step with the config. Each interface with an `exchange` naming a `peeringdb_ixlan` is one record.
//
// Only globally reachable addresses are published: an exchange reached over a tunnel often lands on private or shared space, and publishing it would point others at a dead end. A record the config does not hold is reported, never deleted, and `operational` is never changed, since leaving an exchange is a decision made outside the config.

import { contains, familyOf, host, isGlobal } from "../../core/addr";
import type { Network } from "../../core/define";
import { resolve } from "../../core/secrets";
import type { Device, Interface } from "../../schema";

const API = "https://www.peeringdb.com/api";

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

/** One record as the config describes it. */
type Wanted = {
    name: string;
    ixlan_id: number;
    speed: number;
    ipaddr4: string | null;
    ipaddr6: string | null;
    is_rs_peer: boolean;
};

/** A change to send. `id` is set when the record exists and is updated in place. */
export type PeeringDbChange = {
    summary: string;
    id?: number;
    body: Record<string, unknown>;
};

export type PeeringDbPlan = {
    changes: PeeringDbChange[];
    /** Records PeeringDB holds that the config does not. */
    unknown: string[];
};

type AnyInterface = Interface<string, string>;

const addressesOf = (iface: AnyInterface) => (iface.addresses ?? []).map((entry) => (typeof entry === "string" ? entry : entry.address));

/** Whether the device peers with a route server on this interface's subnets. */
function peersWithRouteServer(device: Device, iface: AnyInterface): boolean {
    const bgp = device.routing?.bgp;
    const subnets = addressesOf(iface);

    return Object.values(bgp?.neighbors ?? {}).some((neighbor) => {
        const group = neighbor.group ? bgp?.groups?.[neighbor.group] : undefined;
        const role = neighbor.role ?? group?.role;
        return role === "rs" && subnets.some((subnet) => contains(subnet, neighbor.address));
    });
}

/** Every exchange presence the config declares with a PeeringDB exchange LAN. */
function wanted(network: Network): Wanted[] {
    const records: Wanted[] = [];

    for (const device of network.devices) {
        for (const iface of Object.values(device.interfaces ?? {})) {
            const exchange = iface.exchange;
            if (!exchange?.peeringdb_ixlan) continue;

            const published = addressesOf(iface).map(host).filter(isGlobal);

            records.push({
                name: exchange.name,
                ixlan_id: exchange.peeringdb_ixlan,
                speed: exchange.speed,
                ipaddr4: published.find((address) => familyOf(address) === "ipv4") ?? null,
                ipaddr6: published.find((address) => familyOf(address) === "ipv6") ?? null,
                is_rs_peer: peersWithRouteServer(device, iface),
            });
        }
    }

    return records;
}

/** What would change at PeeringDB. Reads the public API; needs no key. */
export async function planPeeringDb(network: Network): Promise<PeeringDbPlan> {
    if (!network.asn) throw new Error("the network declares no asn");

    const response = await fetch(`${API}/netixlan?asn=${network.asn}`, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`PeeringDB answered ${response.status}`);

    const existing = ((await response.json()) as { data: NetIxLan[] }).data;
    const desired = wanted(network);

    // The record that owns every presence. Taken from an existing one, since the API has no other lookup by ASN here.
    const netId = existing[0]?.net_id;
    const changes: PeeringDbChange[] = [];

    for (const record of desired) {
        const current = existing.find((candidate) => candidate.ixlan_id === record.ixlan_id);

        const body = {
            net_id: netId,
            ixlan_id: record.ixlan_id,
            asn: network.asn,
            speed: record.speed,
            ipaddr4: record.ipaddr4,
            ipaddr6: record.ipaddr6,
            is_rs_peer: record.is_rs_peer,
            operational: current?.operational ?? true,
        };

        if (!current) {
            changes.push({ summary: `+ ${record.name}: ${record.ipaddr4}, ${record.ipaddr6}, ${record.speed} Mbit/s`, body });
            continue;
        }

        const differs =
            current.ipaddr4 !== record.ipaddr4 ||
            current.ipaddr6 !== record.ipaddr6 ||
            current.speed !== record.speed ||
            current.is_rs_peer !== record.is_rs_peer;

        if (differs) {
            const before = `${current.ipaddr4}, ${current.ipaddr6}, ${current.speed} Mbit/s, route server ${current.is_rs_peer}`;
            const after = `${record.ipaddr4}, ${record.ipaddr6}, ${record.speed} Mbit/s, route server ${record.is_rs_peer}`;
            changes.push({ summary: `~ ${record.name}: ${before} to ${after}`, id: current.id, body });
        }
    }

    const unknown = existing
        .filter((record) => !desired.some((candidate) => candidate.ixlan_id === record.ixlan_id))
        .map((record) => record.name);

    if (changes.some((change) => !change.id) && !netId) {
        throw new Error("PeeringDB holds no presence for this network yet, so its record id is unknown; add the first one by hand");
    }

    return { changes, unknown };
}

/** Send the changes, with the network's API key. */
export async function sendPeeringDb(network: Network, changes: PeeringDbChange[]): Promise<void> {
    if (!network.peeringdb) throw new Error("the network declares no peeringdb api_key");
    const apiKey = resolve(network.peeringdb.api_key);

    for (const change of changes) {
        const response = await fetch(`${API}/netixlan${change.id ? `/${change.id}` : ""}`, {
            method: change.id ? "PUT" : "POST",
            headers: { Authorization: `Api-Key ${apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify(change.body),
            signal: AbortSignal.timeout(30_000),
        });

        if (!response.ok) {
            const reason = (await response.text()).slice(0, 300);
            throw new Error(`${change.summary}: PeeringDB answered ${response.status} ${reason}`);
        }

        console.log(`  sent ${change.summary}`);
    }
}
