// `circuit sync peeringdb` against a fake PeeringDB, never the real one: it adds a presence, changes one that differs, lists one only
// PeeringDB has and an address that isn't global, sends with the key only, and never deletes or changes `operational`.

import { afterEach, expect, test } from "bun:test";
import { Address } from "../../src/core/address";
import { PeeringDb } from "../../src/integrations/peeringdb";
import type { SyncNetwork } from "../../src/integrations/sync";
import type { Device } from "../../src/model";

const realFetch = globalThis.fetch;
afterEach(() => {
    globalThis.fetch = realFetch;
    PeeringDb.publishable = Address.isGlobal;
});

type Sent = { method: string; url: string; key?: string; body?: Record<string, unknown> };

/** A fake PeeringDB: the records it holds for AS64500, the network's own record, and what was sent to it. */
function fakePeeringDb(records: Record<string, unknown>[]): Sent[] {
    const sent: Sent[] = [];

    globalThis.fetch = Object.assign(
        async (input: string | URL | Request, init?: RequestInit) => {
            const url = String(input);
            if (!url.startsWith(`${PeeringDb.API}/`)) throw new Error(`the test reached ${url}`);

            const method = init?.method ?? "GET";
            const key = (init?.headers as Record<string, string>)?.Authorization;
            if (method !== "GET") {
                sent.push({ method, url, ...(key ? { key } : {}), body: JSON.parse(init!.body as string) });
                return Response.json({ data: [] });
            }

            // Reading needs no key.
            if (key) throw new Error("a read sent the key");
            if (url.endsWith("/netixlan?asn=64500")) return Response.json({ data: records });
            if (url.endsWith("/net?asn=64500")) return Response.json({ data: [{ id: 777, asn: 64500 }] });
            return new Response("not found", { status: 404 });
        },
        { preconnect: realFetch.preconnect }
    );

    return sent;
}

/** A router at two exchanges: one with a route server session, one without, and one exchange with no PeeringDB LAN. */
const router = {
    name: "edge-01",
    site: "dc-1",
    platform: "routeros",
    model: "CCR2216-1G-12XS-2XQ",
    connection: { host: "10.0.0.1", user: "admin" },
    interfaces: {
        vlan_interface: {
            "de-cix": {
                vlan: "de-cix",
                addresses: ["192.0.2.10/24", "2001:db8:ffff::10/64"],
                exchange: { name: "DE-CIX Frankfurt", speed: 25000, peeringdb_ixlan: 31 },
            },
            "ams-ix": {
                vlan: "ams-ix",
                addresses: ["198.51.100.20/24"],
                exchange: { name: "AMS-IX", speed: 100000, peeringdb_ixlan: 26 },
            },
            local: { vlan: "local", addresses: ["203.0.113.5/24"], exchange: { name: "A local exchange", speed: 1000 } },
        },
    },
    routing: {
        bgp: {
            neighbor_groups: { "route-servers": { role: "rs" } },
            neighbors: { "de-cix-rs": { address: "192.0.2.1", remote_as: 6695, neighbor_group: "route-servers" } },
        },
    },
} as unknown as Device;

function network(devices: Device[] = [router]): SyncNetwork {
    return {
        name: "as64500",
        asn: 64500,
        sites: { "dc-1": {} },
        integrations: { peeringdb: { api_key: { secret: "PEERINGDB_API_KEY" } } },
        devices,
        reveal: () => "the-key",
    };
}

const amsIx = {
    id: 5,
    net_id: 777,
    ixlan_id: 26,
    name: "AMS-IX",
    speed: 10000,
    ipaddr4: "198.51.100.20",
    ipaddr6: null,
    is_rs_peer: false,
    operational: false,
};
const linx = {
    id: 6,
    net_id: 777,
    ixlan_id: 18,
    name: "LINX LON1",
    speed: 10000,
    ipaddr4: "203.0.113.99",
    ipaddr6: null,
    is_rs_peer: false,
    operational: true,
};

test("adds a presence, changes one that differs, and lists what it leaves alone", async () => {
    // Documentation addresses stand in for global ones here.
    PeeringDb.publishable = () => true;
    const sent = fakePeeringDb([amsIx, linx]);
    const peeringdb = new PeeringDb([network()]);
    const plan = await peeringdb.plan();

    expect(peeringdb.heading).toBe("PeeringDB (AS64500)");
    expect(plan.changes.map((change) => [change.sign, change.what, change.details])).toEqual([
        ["+", "DE-CIX Frankfurt: 25000 Mbit/s, route server yes, 192.0.2.10, 2001:db8:ffff::10", []],
        ["~", "AMS-IX (edge-01 ams-ix)", ["speed: 10000 to 100000 Mbit/s"]],
    ]);
    expect(plan.leftAlone).toEqual([
        "edge-01 local: A local exchange has no exchange.peeringdb_ixlan, so it is not on PeeringDB.",
        "LINX LON1 (203.0.113.99) is on PeeringDB but not in the project. Remove it there by hand if you left.",
    ]);

    await peeringdb.send(plan);

    expect(sent).toEqual([
        {
            method: "POST",
            url: `${PeeringDb.API}/netixlan`,
            key: "Api-Key the-key",
            body: {
                net_id: 777,
                ixlan_id: 31,
                asn: 64500,
                speed: 25000,
                ipaddr4: "192.0.2.10",
                ipaddr6: "2001:db8:ffff::10",
                is_rs_peer: true,
                operational: true,
            },
        },
        {
            // `operational` is sent as PeeringDB holds it, never changed.
            method: "PUT",
            url: `${PeeringDb.API}/netixlan/5`,
            key: "Api-Key the-key",
            body: {
                net_id: 777,
                ixlan_id: 26,
                asn: 64500,
                speed: 100000,
                ipaddr4: "198.51.100.20",
                ipaddr6: null,
                is_rs_peer: false,
                operational: false,
            },
        },
    ]);
});

test("an address that isn't global is listed, not published, and a presence left without one is not sent", async () => {
    // Only the IPv6 address counts as global here.
    PeeringDb.publishable = (address) => address === "2001:db8:ffff::10";
    fakePeeringDb([amsIx]);
    const plan = await new PeeringDb([network()]).plan();

    expect(plan.changes.map((change) => change.what)).toEqual(["DE-CIX Frankfurt: 25000 Mbit/s, route server yes, 2001:db8:ffff::10"]);
    expect(plan.leftAlone).toEqual([
        "edge-01 de-cix: 192.0.2.10 is not a global address, so it is not published.",
        "edge-01 ams-ix: 198.51.100.20 is not a global address, so it is not published.",
        "edge-01 local: A local exchange has no exchange.peeringdb_ixlan, so it is not on PeeringDB.",
        "edge-01 ams-ix: AMS-IX has no global address, so it is not sent to PeeringDB.",
    ]);
});

test("a network without asn can't be synced to PeeringDB", () => {
    const { asn: _, ...withoutAsn } = network();
    expect(() => new PeeringDb([withoutAsn])).toThrow("as64500: integrations.peeringdb needs asn in circuit.ts.");
});
