// `circuit sync prometheus` writes the targets file and snmp_exporter's auths file in the project: one entry per device with SNMP, each
// with its own auth, every password as `${NAME}` and never a value. What it leaves out is listed; a file changed by hand shows its lines.

import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Prometheus } from "../../src/integrations/prometheus";
import type { SyncNetwork } from "../../src/integrations/sync";
import type { Device } from "../../src/model";

const root = mkdtempSync(join(tmpdir(), "circuit-prometheus-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const monitor = {
    auth: "sha256" as const,
    auth_password: { secret: "EDGE_01_SNMP_AUTH" },
    privacy: "aes128" as const,
    privacy_password: { secret: "EDGE_01_SNMP_PRIVACY" },
};

function device(name: string, host: string | undefined, snmp?: NonNullable<Device["monitoring"]>["snmp"]): Device {
    return {
        name,
        site: "dc-1",
        platform: "routeros",
        model: "CCR2216-1G-12XS-2XQ",
        connection: { ...(host ? { host } : {}), user: "admin" },
        ...(snmp ? { monitoring: { snmp } } : {}),
    } as Device;
}

const network: SyncNetwork = {
    name: "as64500",
    sites: { "dc-1": {} },
    integrations: { prometheus: { targets: "monitoring/targets.json", auths: "monitoring/snmp-auths.yml" } },
    devices: [
        device("edge-01", "10.0.0.1", { users: { monitor } }),
        device("tor-01", "10.0.0.2", { community: { secret: "TOR_01_COMMUNITY" } }),
        device("sw-03", "10.0.0.3"),
        device("console-01", undefined, { users: { monitor } }),
    ],
    // Prometheus never needs a secret's value.
    reveal: () => {
        throw new Error("a secret was read");
    },
};

test("writes both files, every password as ${NAME}, lists what it leaves out, then plans nothing", async () => {
    const prometheus = new Prometheus(root, [network]);
    const plan = await prometheus.plan();

    expect(plan.changes.map((change) => `${change.sign} ${change.what}`)).toEqual([
        "+ monitoring/targets.json",
        "+ monitoring/snmp-auths.yml",
    ]);
    expect(plan.leftAlone).toEqual([
        "sw-03 has no monitoring.snmp, so Prometheus can't poll it.",
        "console-01 has no connection.host, so Prometheus has no address to poll.",
        "tor-01 has only an SNMP v2c community, which snmp_exporter can't read from its environment: write it in place of FILL_IN where you deploy the file, or give the device a v3 user.",
    ]);

    await prometheus.send(plan);

    const targets = JSON.parse(readFileSync(join(root, "monitoring/targets.json"), "utf8"));
    expect(targets).toEqual([
        {
            targets: ["10.0.0.1"],
            labels: { device: "edge-01", platform: "routeros", model: "CCR2216-1G-12XS-2XQ", __param_auth: "edge-01" },
        },
        { targets: ["10.0.0.2"], labels: { device: "tor-01", platform: "routeros", model: "CCR2216-1G-12XS-2XQ", __param_auth: "tor-01" } },
    ]);

    expect(readFileSync(join(root, "monitoring/snmp-auths.yml"), "utf8")).toBe(
        [
            "# Written by `circuit sync prometheus`. Load it beside snmp.yml, with --config.expand-environment-variables.",
            "auths:",
            "    edge-01:",
            "        version: 3",
            "        username: monitor",
            "        security_level: authPriv",
            "        password: ${EDGE_01_SNMP_AUTH}",
            "        auth_protocol: SHA256",
            "        priv_protocol: AES",
            "        priv_password: ${EDGE_01_SNMP_PRIVACY}",
            "    tor-01:",
            "        version: 2",
            "        community: FILL_IN",
            "",
        ].join("\n")
    );

    expect((await new Prometheus(root, [network]).plan()).changes).toEqual([]);
});

test("a file changed by hand shows the lines that go and come back", async () => {
    const path = join(root, "monitoring/snmp-auths.yml");
    writeFileSync(path, readFileSync(path, "utf8").replace("username: monitor", "username: someone"));

    const plan = await new Prometheus(root, [network]).plan();
    expect(plan.changes).toEqual([
        { sign: "~", what: "monitoring/snmp-auths.yml", details: ["-         username: someone", "+         username: monitor"] },
    ]);
});
