// Registries keep other systems in step with the network: Prometheus scrape targets and SNMP exporter auths, and the devices LibreNMS does not monitor yet.

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

test("librenms adds what it does not monitor, with the device's SNMP version 3 user", async () => {
    const { LibreNms } = await import("../../src/integrations/librenms");
    const { secret } = await import("../../src/core/define");
    for (const name of ["LIBRENMS_TOKEN", "EXAMPLE_SNMP_AUTH", "EXAMPLE_SNMP_PRIVACY"]) process.env[name] = `${name}-value`;

    const sent: { url: string; init?: RequestInit }[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
        sent.push({ url, init });
        const body =
            init?.method === "POST"
                ? { status: "ok", message: "added" }
                : { devices: [{ hostname: "192.0.2.1" }, { hostname: "198.51.100.9" }] };
        return new Response(JSON.stringify(body));
    }) as typeof fetch;

    try {
        const network = defineNetwork({
            devices: [router, switchDevice],
            librenms: { url: "https://librenms.example/", api_token: secret("LIBRENMS_TOKEN") },
        });
        const plan = await LibreNms.plan(network);

        expect(plan.additions.map((device) => device.name)).toEqual(["example-switch"]);
        expect(plan.unknown).toEqual(["198.51.100.9"]);

        await LibreNms.send(network, plan.additions);
        const post = sent.at(-1)!;
        expect(post.url).toBe("https://librenms.example/api/v0/devices");
        expect((post.init!.headers as Record<string, string>)["X-Auth-Token"]).toBe("LIBRENMS_TOKEN-value");
        expect(JSON.parse(post.init!.body as string)).toEqual({
            hostname: "192.0.2.2",
            display_template: "example-switch",
            snmpver: "v3",
            authlevel: "authPriv",
            authname: "monitor",
            authpass: "EXAMPLE_SNMP_AUTH-value",
            authalgo: "SHA",
            cryptopass: "EXAMPLE_SNMP_PRIVACY-value",
            cryptoalgo: "AES",
        });
    } finally {
        globalThis.fetch = original;
    }
});
