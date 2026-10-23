// Registries keep other systems in step with the network: Prometheus scrape targets and SNMP exporter auths, and what LibreNMS monitors: its devices, their names, credentials and locations, and a group per site.

import { expect, test } from "bun:test";
import { defineNetwork } from "../../src/core/define";
import router from "../../examples/platforms/routeros";
import switchDevice from "../../examples/platforms/vrp";

test("prometheus lists every device with SNMP, each with its own auth, and no secret in the auths", async () => {
    const { Prometheus } = await import("../../src/integrations/prometheus");
    const network = defineNetwork({ devices: [router, switchDevice] });

    expect(Prometheus.targets(network).targets.map((target) => [target.targets, target.labels.__param_auth])).toEqual([
        [["192.0.2.1"], "example-router"],
        [["192.0.2.2"], "example-switch"],
    ]);

    const { yaml, notes } = Prometheus.snmpExporterAuths(network);
    expect(yaml).toContain(
        "  example-switch:\n    version: 3\n    username: monitor\n    security_level: authPriv\n    password: ${EXAMPLE_SNMP_AUTH}"
    );
    expect(yaml).toContain("    priv_password: ${EXAMPLE_SNMP_PRIVACY}");
    expect(notes).toEqual([]);
});

/** A fake LibreNMS: answers each request from `routes`, by method and path, and keeps what was sent. */
function fakeLibreNms(routes: Record<string, unknown>) {
    const sent: { method: string; path: string; body?: unknown }[] = [];
    const original = globalThis.fetch;

    globalThis.fetch = (async (url: string, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        const path = decodeURIComponent(new URL(url).pathname.replace("/api/v0/", "")) + new URL(url).search;
        sent.push({ method, path, body: init?.body ? JSON.parse(init.body as string) : undefined });

        const answer = routes[`${method} ${path}`];
        if (answer === undefined) return new Response(JSON.stringify({ status: "error", message: "not found" }), { status: 404 });
        return new Response(JSON.stringify(answer));
    }) as typeof fetch;

    return { sent, restore: () => (globalThis.fetch = original) };
}

const V3 = {
    snmpver: "v3",
    authlevel: "authPriv",
    authname: "monitor",
    authpass: "EXAMPLE_SNMP_AUTH-value",
    authalgo: "SHA",
    cryptopass: "EXAMPLE_SNMP_PRIVACY-value",
    cryptoalgo: "AES",
};

test("librenms adds what it does not monitor, changes what differs, and makes a group per site", async () => {
    const { LibreNms } = await import("../../src/integrations/librenms");
    const { secret } = await import("../../src/core/define");
    for (const name of ["LIBRENMS_TOKEN", "EXAMPLE_SNMP_AUTH", "EXAMPLE_SNMP_PRIVACY"]) process.env[name] = `${name}-value`;

    const fake = fakeLibreNms({
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

    try {
        const network = defineNetwork({
            devices: [router, switchDevice],
            site: () => "Site A",
            librenms: { url: "https://librenms.example/", api_token: secret("LIBRENMS_TOKEN") },
        });
        const plan = await LibreNms.plan(network);

        expect(plan.additions.map((device) => device.name)).toEqual(["example-switch"]);
        expect(plan.unknown).toEqual(["198.51.100.9"]);
        expect(plan.changes.map((change) => [change.device.name, change.what])).toEqual([
            ["example-router", ["name", "SNMP credentials", "location"]],
        ]);
        expect(plan.groups).toEqual([{ name: "Site A", create: true, add: [router, switchDevice], remove: [] }]);

        await LibreNms.send(network, plan);

        expect(fake.sent.filter((request) => request.method !== "GET")).toEqual([
            { method: "POST", path: "devices", body: { hostname: "192.0.2.2", display_template: "example-switch", ...V3 } },
            {
                method: "PATCH",
                path: "devices/1",
                body: {
                    field: ["display_template", ...Object.keys(V3), "location"],
                    data: ["example-router", ...Object.values(V3), "Rack 1"],
                },
            },
            {
                method: "POST",
                path: "devicegroups",
                body: { name: "Site A", desc: "The devices at Site A, kept by Circuit", type: "static", devices: [1, 2] },
            },
        ]);
    } finally {
        fake.restore();
    }
});

test("librenms moves a device between site groups and leaves a dynamic group alone", async () => {
    const { LibreNms } = await import("../../src/integrations/librenms");
    const { secret } = await import("../../src/core/define");
    for (const name of ["LIBRENMS_TOKEN", "EXAMPLE_SNMP_AUTH", "EXAMPLE_SNMP_PRIVACY"]) process.env[name] = `${name}-value`;

    const monitored = (id: number, device: typeof router, location?: string) => ({
        device_id: id,
        hostname: device.connection.host,
        display: device.name,
        location: location ?? null,
        ...V3,
    });

    const fake = fakeLibreNms({
        "GET devices?type=all": { status: "ok", devices: [monitored(1, router, "Rack 1"), monitored(2, switchDevice)] },
        "GET devicegroups": {
            status: "ok",
            groups: [
                { id: 1, name: "Site A", type: "static" },
                { id: 2, name: "Site B", type: "static" },
            ],
        },
        // The router is still in Site A beside a device the config does not have, and Site B is empty.
        "GET devicegroups/Site A": { status: "ok", devices: [{ device_id: 1 }, { device_id: 9 }] },
        "POST devicegroups/Site A/devices": { status: "ok" },
        "DELETE devicegroups/Site A/devices": { status: "ok" },
        "POST devicegroups/Site B/devices": { status: "ok" },
    });

    try {
        const network = defineNetwork({
            devices: [router, switchDevice],
            site: (device) => (device === router ? "Site B" : "Site A"),
            librenms: { url: "https://librenms.example/", api_token: secret("LIBRENMS_TOKEN") },
        });
        const plan = await LibreNms.plan(network);

        expect(plan.changes).toEqual([]);
        expect(plan.groups).toEqual([
            { name: "Site A", create: false, add: [switchDevice], remove: [router] },
            { name: "Site B", create: false, add: [router], remove: [] },
        ]);

        await LibreNms.send(network, plan);

        expect(fake.sent.filter((request) => request.method !== "GET")).toEqual([
            { method: "POST", path: "devicegroups/Site A/devices", body: { devices: [2] } },
            { method: "DELETE", path: "devicegroups/Site A/devices", body: { devices: [1] } },
            { method: "POST", path: "devicegroups/Site B/devices", body: { devices: [1] } },
        ]);
    } finally {
        fake.restore();
    }

    const dynamic = fakeLibreNms({
        "GET devices?type=all": { status: "ok", devices: [monitored(1, router, "Rack 1"), monitored(2, switchDevice)] },
        "GET devicegroups": { status: "ok", groups: [{ id: 1, name: "Site A", type: "dynamic" }] },
    });

    try {
        const network = defineNetwork({
            devices: [router, switchDevice],
            site: () => "Site A",
            librenms: { url: "https://librenms.example/", api_token: secret("LIBRENMS_TOKEN") },
        });
        const plan = await LibreNms.plan(network);

        expect(plan.groups).toEqual([]);
        expect(plan.dynamicGroups).toEqual(["Site A"]);
        expect(LibreNms.count(plan)).toBe(0);
    } finally {
        dynamic.restore();
    }
});
