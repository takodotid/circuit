// `circuit sync librenms` against a fake LibreNMS: it adds what it doesn't monitor, changes what differs, keeps one static group per site,
// lists what it leaves alone (a host the project doesn't have, a device without SNMP or without a management address, a dynamic group), and
// never prints a secret.

import { afterEach, expect, test } from "bun:test";
import { LibreNms } from "../../src/integrations/librenms";
import { Sync, type SyncNetwork } from "../../src/integrations/sync";
import type { Device, Secret } from "../../src/model";

const realFetch = globalThis.fetch;
afterEach(() => {
    globalThis.fetch = realFetch;
});

/** A fake LibreNMS: answers each request from `routes`, by method and path, and keeps what was sent. */
function fakeLibreNms(routes: Record<string, unknown>) {
    const sent: { method: string; path: string; body?: unknown }[] = [];

    globalThis.fetch = Object.assign(
        async (input: string | URL | Request, init?: RequestInit) => {
            const url = new URL(String(input));
            if (url.host !== "librenms.example.com") throw new Error(`the test reached ${url.host}`);

            const method = init?.method ?? "GET";
            const path = decodeURIComponent(url.pathname.replace("/api/v0/", "")) + url.search;
            if (method !== "GET") sent.push({ method, path, body: JSON.parse(init!.body as string) });

            const answer = routes[`${method} ${path}`];
            if (answer === undefined) return new Response(JSON.stringify({ status: "error", message: "not found" }), { status: 404 });
            return new Response(JSON.stringify(answer));
        },
        { preconnect: realFetch.preconnect }
    );

    return sent;
}

const monitor = {
    auth: "sha1" as const,
    auth_password: { secret: "SNMP_AUTH" },
    privacy: "aes128" as const,
    privacy_password: { secret: "SNMP_PRIVACY" },
};

/** A device with only what LibreNMS reads. */
function device(name: string, site: string, host: string | undefined, snmp?: NonNullable<Device["monitoring"]>["snmp"]): Device {
    return {
        name,
        site,
        platform: "routeros",
        model: "CCR2216-1G-12XS-2XQ",
        connection: { ...(host ? { host: host as `${number}.${number}.${number}.${number}` } : {}), user: "admin" },
        ...(snmp ? { monitoring: { snmp } } : {}),
    } as Device;
}

const router = device("edge-01", "dc-1", "192.0.2.1", { users: { monitor }, location: "Rack 1" });
const switchDevice = device("tor-01", "dc-1", "192.0.2.2", { users: { monitor } });

/** Every secret's value, as its name and `-value`, so the test can look for it in what is printed. */
const reveal = (secret: Secret) => `${"secret" in secret ? secret.secret : secret.secret_file}-value`;

function network(devices: Device[]): SyncNetwork {
    return {
        name: "as64500",
        sites: { "dc-1": {}, "dc-2": {} },
        integrations: { librenms: { url: "https://librenms.example.com/", api_token: { secret: "LIBRENMS_API_TOKEN" } } },
        devices,
        reveal,
    };
}

const V3 = {
    snmpver: "v3",
    authlevel: "authPriv",
    authname: "monitor",
    authpass: "SNMP_AUTH-value",
    authalgo: "SHA",
    cryptopass: "SNMP_PRIVACY-value",
    cryptoalgo: "AES",
};

/** How a change of credentials is printed: what isn't a secret, before and after; a secret only as differing. */
const CREDENTIAL_LINES = [
    'snmpver: "v2c" to "v3"',
    'authlevel: null to "authPriv"',
    'authname: null to "monitor"',
    "authpass: differs (not shown)",
    'authalgo: null to "SHA"',
    "cryptopass: differs (not shown)",
    'cryptoalgo: null to "AES"',
];

test("adds what it doesn't monitor, changes what differs, makes a group per site, and lists the rest", async () => {
    const sent = fakeLibreNms({
        "GET devices?type=all": {
            status: "ok",
            devices: [
                { device_id: 1, hostname: "192.0.2.1", display: "192.0.2.1", snmpver: "v2c", community: "public", location: null },
                { device_id: 9, hostname: "198.51.100.9", display: "printer" },
            ],
        },
        "POST devices": { status: "ok", message: "added", devices: [{ device_id: 2, hostname: "192.0.2.2" }] },
        "PATCH devices/1": { status: "ok", message: "Device fields have been updated" },
        "POST devicegroups": { status: "ok", id: 5 },
    });

    const quiet = device("sw-03", "dc-1", "192.0.2.3");
    const consoleOnly = device("console-01", "dc-1", undefined, { users: { monitor } });
    const librenms = new LibreNms([network([router, switchDevice, quiet, consoleOnly])]);
    const plan = await librenms.plan();

    expect(plan.changes.map((change) => [change.sign, change.what, change.details])).toEqual([
        ["~", "edge-01", ['display_template: null to "edge-01"', ...CREDENTIAL_LINES, 'location: null to "Rack 1"']],
        ["+", "tor-01, 192.0.2.2, SNMP v3 user monitor", []],
        ["+", "group dc-1 with edge-01, tor-01", []],
    ]);
    expect(plan.leftAlone).toEqual([
        "sw-03 has no monitoring.snmp, so LibreNMS can't poll it.",
        "LibreNMS monitors 198.51.100.9, which no device in the project has. Remove it there by hand if it is gone.",
        "console-01 has no connection.host, so LibreNMS has nothing to poll.",
    ]);

    // No secret's value in what is printed.
    const printed = Sync.text(librenms.heading, plan).join("\n");
    for (const value of Object.values(V3).filter((value) => value.endsWith("-value"))) expect(printed).not.toContain(value);
    expect(printed).not.toContain("public");

    await librenms.send(plan);

    expect(sent).toEqual([
        { method: "POST", path: "devices", body: { hostname: "192.0.2.2", display_template: "tor-01", ...V3 } },
        {
            method: "PATCH",
            path: "devices/1",
            body: { field: ["display_template", ...Object.keys(V3), "location"], data: ["edge-01", ...Object.values(V3), "Rack 1"] },
        },
        {
            method: "POST",
            path: "devicegroups",
            body: { name: "dc-1", desc: "The devices at dc-1, kept by Circuit", type: "static", devices: [1, 2] },
        },
    ]);
});

const monitored = (id: number, each: Device, location?: string) => ({
    device_id: id,
    hostname: each.connection.host,
    display: each.name,
    location: location ?? null,
    ...V3,
});

test("moves a device between site groups, and leaves a dynamic group alone", async () => {
    const moved = { ...router, site: "dc-2" };
    const sent = fakeLibreNms({
        "GET devices?type=all": { status: "ok", devices: [monitored(1, router, "Rack 1"), monitored(2, switchDevice)] },
        "GET devicegroups": {
            status: "ok",
            groups: [
                { id: 1, name: "dc-1", type: "static" },
                { id: 2, name: "dc-2", type: "static" },
            ],
        },
        // The router is still in dc-1 beside a device the project doesn't have, and dc-2 is empty.
        "GET devicegroups/dc-1": { status: "ok", devices: [{ device_id: 1 }, { device_id: 9 }] },
        "POST devicegroups/dc-1/devices": { status: "ok" },
        "DELETE devicegroups/dc-1/devices": { status: "ok" },
        "POST devicegroups/dc-2/devices": { status: "ok" },
    });

    const librenms = new LibreNms([network([moved, switchDevice])]);
    const plan = await librenms.plan();

    expect(plan.changes.map((change) => [change.what, change.details])).toEqual([
        ["group dc-1", ["add tor-01", "remove edge-01"]],
        ["group dc-2", ["add edge-01"]],
    ]);
    expect(plan.leftAlone).toEqual(["group dc-1 also holds 1 device(s) not in the project; they stay."]);

    await librenms.send(plan);

    expect(sent).toEqual([
        { method: "POST", path: "devicegroups/dc-1/devices", body: { devices: [2] } },
        { method: "DELETE", path: "devicegroups/dc-1/devices", body: { devices: [1] } },
        { method: "POST", path: "devicegroups/dc-2/devices", body: { devices: [1] } },
    ]);

    fakeLibreNms({
        "GET devices?type=all": { status: "ok", devices: [monitored(1, router, "Rack 1"), monitored(2, switchDevice)] },
        "GET devicegroups": { status: "ok", groups: [{ id: 1, name: "dc-1", type: "dynamic" }] },
    });

    const dynamic = await new LibreNms([network([router, switchDevice])]).plan();
    expect(dynamic.changes).toEqual([]);
    expect(dynamic.leftAlone).toEqual(["group dc-1 is a dynamic group in LibreNMS, so Circuit can't fill it, and leaves it as it is."]);
});
