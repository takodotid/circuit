// `circuit sync netbox` against a fake NetBox: what it makes on an empty one, that a second plan is empty, that it never touches what holds
// no `circuit` tag, that networks sharing one NetBox are planned together, what it lists under Left alone, and that `validate` asks for a role.

import { afterAll, afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SyncCommand } from "../../src/cli/sync";
import { NetBox } from "../../src/integrations/netbox";
import type { SyncNetwork } from "../../src/integrations/sync";
import type { Device } from "../../src/model";
import { ProjectError, type ProjectNetwork, readProject } from "../../src/project/project";
import { Fixtures } from "../fixtures";

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
    readonly headers: string[] = [];
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

    handle = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        const url = new URL(String(input));
        if (url.host !== "netbox.example.com") throw new Error(`the test reached ${url.host}`);

        const method = init?.method ?? "GET";
        const path = url.pathname.replace(/^\/api\//, "").replace(/\/$/, "");
        const body = init?.body ? (JSON.parse(init.body as string) as Json) : undefined;
        this.headers.push(String((init?.headers as Record<string, string>)?.Authorization));
        if (method !== "GET") this.sent.push({ method, path, ...(body ? { body } : {}) });

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

// The colocation example's router and switch, from the fixtures, at one site with a role each.
const SITES = { "dc-1": { description: "The data centre" } };
const edge: Device = { ...Fixtures.device("colocation--edge-01"), site: "dc-1", role: "Edge router" };
const tor: Device = { ...Fixtures.device("colocation--tor-01"), site: "dc-1", role: "Top-of-rack switch" };

const SETTINGS = { netbox: { url: "https://netbox.example.com/" as const, api_token: { secret: "NETBOX_API_TOKEN" } } };

/** One network of the example's devices, using the fake NetBox. */
function network(devices: Device[], name = "as64500"): SyncNetwork {
    return { name, asn: 64500, sites: SITES, integrations: SETTINGS, devices, reveal: () => "nbt_abc.def" };
}

let fake: FakeNetBox;
const realFetch = globalThis.fetch;

beforeEach(() => {
    fake = new FakeNetBox();
    globalThis.fetch = Object.assign(fake.handle, { preconnect: realFetch.preconnect });
});

afterEach(() => {
    globalThis.fetch = realFetch;
});

test("an empty NetBox gets every object, tagged circuit, and a second plan is empty", async () => {
    const netbox = new NetBox([network([edge, tor])]);
    const plan = await netbox.plan();

    expect(plan.updates).toEqual([]);
    expect(plan.deletes).toEqual([]);
    expect(plan.creates[0]!.key).toBe("circuit");
    expect(plan.changes.map((change) => `${change.sign} ${change.what}`)).toContain("+ dcim/cables edge-01/qsfp28-1-1 to tor-01/40GE1/0/1");
    expect(plan.summary).toContain("dcim/devices: 2 to create, 0 to change, 0 to delete");

    await netbox.send(plan);
    expect((await new NetBox([network([edge, tor])]).plan()).changes).toEqual([]);

    // A version 2 token goes after Bearer.
    expect(fake.headers.every((header) => header === "Bearer nbt_abc.def")).toBe(true);

    // Ports carry the device's own names, with Circuit's as their label; one the file leaves out is off.
    const router = fake.find("dcim/devices", (o) => o.name === "edge-01")!;
    const uplink = fake.find("dcim/interfaces", (o) => o.name === "qsfp28-1-1")!;
    expect(uplink.label).toBe("100g-1");
    expect(uplink.mode).toBe("tagged");
    expect(fake.find("dcim/interfaces", (o) => o.device === router.id && o.label === "25g-4")!.enabled).toBe(false);

    // The site carries its description from circuit.ts, and the role is the device's own.
    expect(fake.find("dcim/sites", (o) => o.name === "dc-1")!.description).toBe("The data centre");
    expect(fake.find("dcim/device-roles", (o) => o.id === router.role)!.name).toBe("Edge router");

    // The device's primary address is the one Circuit reaches it at, set in the second round.
    expect(fake.find("ipam/ip-addresses", (o) => o.id === router.primary_ip4)!.address).toBe("10.0.0.1/24");
    expect(router.tags).toEqual([fake.tagId()]);

    // An address on no interface of ours, and the prefix originated, as a container.
    expect(fake.find("ipam/ip-addresses", (o) => o.address === "203.0.113.1/30")!.description).toBe(
        "BGP neighbor hurricane-electric of edge-01"
    );
    expect(fake.find("ipam/prefixes", (o) => o.prefix === "198.51.100.0/24")!.status).toBe("container");

    // A VLAN interface's prefix is on its VLAN, at the device's site.
    const mgmt = fake.find("ipam/prefixes", (o) => o.prefix === "10.0.99.0/24")!;
    expect(fake.find("ipam/vlans", (o) => o.id === mgmt.vlan)!.vid).toBe(99);
    expect(mgmt.scope_id).toBe(fake.find("dcim/sites", (o) => o.name === "dc-1")!.id);
});

test("only what holds the tag is changed or deleted, and what doesn't is listed as left alone", async () => {
    await new NetBox([network([edge, tor])]).send(await new NetBox([network([edge, tor])]).plan());
    const tag = fake.tagId();

    // An IPv4 written another way is the same address; a tagged interface changed by hand is changed back.
    fake.find("dcim/interfaces", (o) => o.name === "qsfp28-1-1")!.description = "edited by hand";
    const router = fake.find("dcim/devices", (o) => o.name === "edge-01")!;
    const oldRouter = fake.add("dcim/devices", { ...router, id: undefined, name: "old-router", primary_ip4: null, tags: [tag] });
    fake.add("dcim/devices", { ...router, id: undefined, name: "rack-pdu", primary_ip4: null, tags: [] });

    // A device of the project that NetBox holds without the tag is left as it is.
    const torId = fake.find("dcim/devices", (o) => o.name === "tor-01")!.id;
    Object.assign(
        fake.find("dcim/devices", (o) => o.id === torId)!,
        { tags: [], status: "planned" }
    );

    const plan = await new NetBox([network([edge, tor])]).plan();

    expect(plan.creates).toEqual([]);
    expect(plan.updates.map((change) => [change.key, change.diff])).toEqual([
        ["edge-01/qsfp28-1-1", ['description: "edited by hand" to "tor-01"']],
    ]);
    expect(plan.deletes.map((change) => change.key)).toEqual(["old-router"]);
    expect(plan.leftAlone).toContain("dcim/devices tor-01: in NetBox without the tag circuit, so it is used as it is.");

    fake.sent.length = 0;
    await new NetBox([network([edge, tor])]).send(plan);

    expect(fake.sent.map((request) => `${request.method} ${request.path}`)).toEqual([
        `DELETE dcim/devices/${oldRouter}`,
        `PATCH dcim/interfaces/${fake.find("dcim/interfaces", (o) => o.name === "qsfp28-1-1")!.id}`,
    ]);
    expect(fake.find("dcim/devices", (o) => o.name === "rack-pdu")).toBeDefined();
    expect(fake.find("dcim/devices", (o) => o.id === torId)!.status).toBe("planned");
});

test("two networks that name one NetBox are planned together, so neither deletes what the other made", async () => {
    const a = network([edge], "as64500");
    const b = network([tor], "lab");
    const both = new NetBox([a, b]);
    await both.send(await both.plan());

    expect((await new NetBox([a, b]).plan()).changes).toEqual([]);
    // Planned alone, one network would delete the other's device.
    expect((await new NetBox([a]).plan()).deletes.map((change) => change.key)).toContain("tor-01");

    // `circuit sync` puts them together by the NetBox they name.
    const projectNetwork = (name: string, url: string): ProjectNetwork => ({
        name,
        asn: 64500,
        communities: [],
        devices: {},
        files: {},
        settings: { sites: {}, integrations: { netbox: { url, api_token: { secret: "T" } } } },
    });
    const groups = SyncCommand.groups(
        {
            networks: [
                projectNetwork("as64500", "https://netbox.example.com"),
                projectNetwork("lab", "https://netbox.example.com/"),
                projectNetwork("other", "https://netbox.other.example"),
            ],
            warnings: [],
        },
        "netbox"
    );
    expect(groups.map((group) => group.map((each) => each.name))).toEqual([["as64500", "lab"], ["other"]]);
});

test("what NetBox can't show is listed: a link to a device not in the project, BGP sessions", async () => {
    const linked: Device = {
        ...edge,
        interfaces: {
            ...edge.interfaces,
            ethernet: {
                ...edge.interfaces?.ethernet,
                "25g-1": { description: "isp-router", link: { device: "isp-router", port: "1g-1" } },
            },
        },
    };
    const plan = await new NetBox([network([linked, tor])]).plan();

    expect(plan.leftAlone).toContain("edge-01 25g-1 links to isp-router, which is not in the networks that use this NetBox, so no cable.");
    expect(plan.leftAlone).toContain("BGP sessions (3): NetBox has no place for them without a plugin.");
});

const folder = mkdtempSync(join(tmpdir(), "circuit-netbox-role-"));
afterAll(() => rmSync(folder, { recursive: true, force: true }));

test("validate stops on a device without a role when NetBox is set", async () => {
    writeFileSync(
        join(folder, "circuit.ts"),
        `export const net = circuit({ sites: { home: {} }, integrations: { netbox: { url: "https://netbox.example.com", api_token: secret("NETBOX_API_TOKEN") } } });\n`
    );
    mkdirSync(join(folder, "sites", "home"), { recursive: true });
    const device = {
        name: "cpe-01",
        site: "home",
        platform: "routeros",
        model: "RB5009UG+S+",
        connection: { host: "192.0.2.1", user: "admin" },
        system: { users: { admin: { role: "admin", password: { secret: "PASSWORD" } } } },
    };
    writeFileSync(
        join(folder, "sites", "home", "cpe-01.ts"),
        `import { net } from "../../circuit";\n\nexport default net.device(${JSON.stringify(device, null, 4)});\n`
    );

    const stopped = await readProject(folder).then(
        () => [],
        (error: unknown) => (error instanceof ProjectError ? error.lines : [String(error)])
    );
    expect(stopped).toEqual([
        `sites/home/cpe-01.ts:3: cpe-01: NetBox needs a role (integrations.netbox). Write role, such as role: "Edge router".`,
    ]);
});
