// `circuit netbox` against a fake NetBox: what it makes on an empty one, that a second plan is empty, and that it never touches what holds no `circuit` tag.

import { afterEach, beforeEach, expect, test } from "bun:test";
import { defineNetwork, secret } from "../../src/core/define";
import { NetBox } from "../../src/integrations/netbox";
import type { Device } from "../../src/schema";
import router from "../../examples/platforms/routeros";
import switchDevice from "../../examples/platforms/vrp";

type Json = { [field: string]: any };

/** NetBox's API in memory: lists, makes, changes and deletes objects, and answers with nested objects and choices the way NetBox 4 does. */
class FakeNetBox {
    /** Fields that refer to another object, and where that object is kept. */
    private static readonly REFERENCES: Record<string, string> = {
        device: "dcim/devices",
        site: "dcim/sites",
        manufacturer: "dcim/manufacturers",
        platform: "dcim/platforms",
        device_type: "dcim/device-types",
        vrf: "ipam/vrfs",
        lag: "dcim/interfaces",
        bridge: "dcim/interfaces",
        untagged_vlan: "ipam/vlans",
        vlan: "ipam/vlans",
        primary_ip4: "ipam/ip-addresses",
        primary_ip6: "ipam/ip-addresses",
        tagged_vlans: "ipam/vlans",
        tags: "extras/tags",
    };

    private static readonly CHOICES = new Set(["status", "mode", "type"]);

    readonly objects = new Map<string, Map<number, Json>>();
    readonly sent: { method: string; path: string; body?: Json }[] = [];
    private nextId = 1;

    /** Add an object as NetBox would hold it, with plain ids for references. */
    add(path: string, object: Json): number {
        const id = this.nextId++;
        this.kind(path).set(id, { ...object, id });
        return id;
    }

    tagId(): number {
        return [...this.kind("extras/tags").values()].find((tag) => tag.slug === "circuit")!.id;
    }

    find(path: string, match: (object: Json) => boolean): Json | undefined {
        return [...this.kind(path).values()].find(match);
    }

    handle = async (url: string, init?: RequestInit): Promise<Response> => {
        const method = init?.method ?? "GET";
        const path = new URL(url).pathname.replace(/^\/api\//, "").replace(/\/$/, "");
        const body = init?.body ? (JSON.parse(init.body as string) as Json) : undefined;
        if (method !== "GET") this.sent.push({ method, path, body });

        const [kind, id] = /^(.+?)(?:\/(\d+))?$/.exec(path)!.slice(1) as [string, string | undefined];

        if (method === "GET") {
            const results = [...this.kind(kind).values()].map((object) => this.expand(kind, object, 2));
            return Response.json({ count: results.length, next: null, previous: null, results });
        }

        if (method === "POST") return Response.json(this.expand(kind, this.kind(kind).get(this.add(kind, body!))!, 2), { status: 201 });

        if (method === "PATCH") {
            const object = this.kind(kind).get(Number(id))!;
            Object.assign(object, body);
            return Response.json(this.expand(kind, object, 2));
        }

        if (!this.kind(kind).delete(Number(id))) return new Response("not found", { status: 404 });
        return new Response(null, { status: 204 });
    };

    private kind(path: string): Map<number, Json> {
        if (!this.objects.has(path)) this.objects.set(path, new Map());
        return this.objects.get(path)!;
    }

    private nested(path: string, id: unknown, depth: number): Json | null {
        const object = typeof id === "number" ? this.kind(path).get(id) : undefined;
        return object ? (depth > 0 ? this.expand(path, object, depth - 1) : { id: object.id }) : null;
    }

    /** An object as NetBox answers with it: references as nested objects, choices as value and label. */
    private expand(path: string, object: Json, depth: number): Json {
        const out: Json = {};

        for (const [field, value] of Object.entries(object)) {
            const target = field === "role" && path === "dcim/devices" ? "dcim/device-roles" : FakeNetBox.REFERENCES[field];

            if (field.endsWith("_terminations")) {
                out[field] = (value as Json[]).map((end) => ({ ...end, object: this.nested("dcim/interfaces", end.object_id, depth) }));
            } else if (target && Array.isArray(value)) {
                out[field] = value.map((id) => this.nested(target, id, depth));
            } else if (target) {
                out[field] = this.nested(target, value, depth);
            } else if ((FakeNetBox.CHOICES.has(field) || (field === "role" && path === "ipam/ip-addresses")) && value !== null) {
                out[field] = { value, label: String(value) };
            } else {
                out[field] = value;
            }
        }

        if (object.assigned_object_type === "dcim.interface") {
            out.assigned_object = this.nested("dcim/interfaces", object.assigned_object_id, depth);
        }

        return out;
    }
}

let fake: FakeNetBox;
const original = globalThis.fetch;

beforeEach(() => {
    process.env.NETBOX_TOKEN = "nbt_abc.def";
    fake = new FakeNetBox();
    globalThis.fetch = fake.handle as unknown as typeof fetch;
});

afterEach(() => {
    globalThis.fetch = original;
});

/** The router and the switch, cabled router 100g-1 to switch 40g-3, at one site. */
function network() {
    const linked = {
        ...router,
        ports: { ...router.ports, "100g-1": { ...router.ports!["100g-1"], link: { device: "example-switch", port: "40g-3" } } },
    } as Device;

    return defineNetwork({
        devices: [linked, switchDevice],
        site: () => "Site A",
        netbox: {
            url: "https://netbox.example/",
            api_token: secret("NETBOX_TOKEN"),
            device: (device) => ({ role: device.platform === "routeros" ? "Router" : "Switch" }),
        },
    });
}

test("netbox makes every object on an empty NetBox, then plans nothing", async () => {
    const netbox = new NetBox(network());
    const plan = await netbox.plan();

    expect(plan.updates).toEqual([]);
    expect(plan.deletes).toEqual([]);
    expect(plan.creates[0]!.key).toBe("circuit");
    expect(plan.creates.map((change) => change.key)).toContain("example-router/qsfp28-1-1 to example-switch/40GE1/0/3");

    const left = await netbox.send(plan);
    expect(NetBox.count(left)).toBe(0);
    expect(NetBox.count(await new NetBox(network()).plan())).toBe(0);

    // Ports carry the device's own names, with Circuit's as their label; one the config leaves out is off.
    const device = fake.find("dcim/devices", (o) => o.name === "example-router")!;
    const bondMember = fake.find("dcim/interfaces", (o) => o.name === "sfp28-1")!;
    const lag = fake.find("dcim/interfaces", (o) => o.name === "uplink" && o.device === device.id)!;
    expect(bondMember.label).toBe("25g-1");
    expect(bondMember.lag).toBe(lag.id);
    expect(fake.find("dcim/interfaces", (o) => o.name === "40GE1/0/6")!.enabled).toBe(false);

    // The device's primary address is the one Circuit reaches it at, set in the second round.
    const primary = fake.find("ipam/ip-addresses", (o) => o.id === device.primary_ip4)!;
    expect(primary.address).toBe("192.0.2.1/24");
    expect(device.tags).toEqual([fake.tagId()]);

    // Addresses on no interface of ours, and DHCP pools as ranges.
    expect(fake.find("ipam/ip-addresses", (o) => o.address === "192.0.2.254/24")!.description).toBe(
        "VRRP 1 on example-router, example-switch"
    );
    expect(fake.find("ipam/ip-ranges", (o) => o.start_address === "198.51.100.100/26")!.end_address).toBe("198.51.100.120/26");

    // A VLAN interface's prefix is on its VLAN, at the device's site.
    const servers = fake.find("ipam/prefixes", (o) => o.prefix === "2001:db8:20::/64")!;
    expect(fake.find("ipam/vlans", (o) => o.id === servers.vlan)!.vid).toBe(20);
    expect(servers.scope_id).toBe(fake.find("dcim/sites", (o) => o.name === "Site A")!.id);
});

test("netbox changes and deletes only what holds its tag, and reads IPv6 in any spelling", async () => {
    await new NetBox(network()).send(await new NetBox(network()).plan());
    const tag = fake.tagId();

    // An IPv6 address written out in full is the same address.
    const servers = fake.find("ipam/ip-addresses", (o) => o.address === "2001:db8:20::1/64")!;
    servers.address = "2001:DB8:20:0:0:0:0:1/64";

    // A tagged interface changed by hand is changed back; a tagged device the config no longer has is deleted; untagged ones are never touched.
    fake.find("dcim/interfaces", (o) => o.name === "sfp28-3")!.description = "edited by hand";
    const site = fake.find("dcim/sites", (o) => o.name === "Site A")!.id;
    const deviceType = fake.find("dcim/devices", (o) => o.name === "example-router")!.device_type;
    const role = fake.find("dcim/devices", (o) => o.name === "example-router")!.role;
    const oldRouter = fake.add("dcim/devices", { name: "old-router", site, device_type: deviceType, role, status: "active", tags: [tag] });
    fake.add("dcim/devices", { name: "rack-pdu", site, device_type: deviceType, role, status: "active", tags: [] });

    // A device of the config that NetBox holds without the tag is left as it is.
    const switchId = fake.find("dcim/devices", (o) => o.name === "example-switch")!.id;
    fake.find("dcim/devices", (o) => o.id === switchId)!.tags = [];
    fake.find("dcim/devices", (o) => o.id === switchId)!.status = "planned";

    const plan = await new NetBox(network()).plan();

    expect(plan.creates).toEqual([]);
    expect(plan.updates.map((change) => [change.key, change.diff])).toEqual([
        ["example-router/sfp28-3", ['description: "edited by hand" to "Host"']],
    ]);
    expect(plan.deletes.map((change) => change.key)).toEqual(["old-router"]);
    expect(plan.leftAlone).toEqual(["dcim/devices example-switch"]);

    fake.sent.length = 0;
    await new NetBox(network()).send(plan);

    expect(fake.sent.map((request) => `${request.method} ${request.path}`)).toEqual([
        `DELETE dcim/devices/${oldRouter}`,
        `PATCH dcim/interfaces/${fake.find("dcim/interfaces", (o) => o.name === "sfp28-3")!.id}`,
    ]);
    expect(fake.find("dcim/devices", (o) => o.name === "rack-pdu")).toBeDefined();
    expect(fake.find("dcim/devices", (o) => o.id === switchId)!.status).toBe("planned");
});

test("netbox needs a site for every device", () => {
    const { site: _, ...withoutSite } = network();
    expect(() => new NetBox(withoutSite)).toThrow("the network has no site");
});
