// A DHCP client's default routes and a WireGuard interface's own packets name routing tables, and UPnP names interfaces: each name is
// one the device declares, and a table a DHCP client fills counts as filled.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Validation } from "../../src/checks";
import { ProjectError, readProject } from "../../src/project/project";

const folder = mkdtempSync(join(tmpdir(), "circuit-customer-router-"));
let stopped: string[] = [];

const router = (tables: string[]) => ({
    name: "cpe-01",
    site: "home",
    platform: "routeros",
    model: "RB5009UG+S+",
    connection: { host: "192.168.77.1", user: "admin" },
    system: { users: { admin: { role: "admin", password: { secret: "PASSWORD" } } } },
    interfaces: {
        ethernet: { "1g-1": { dhcp_client: { default_routes: [{ routing_table: "isp1" }, { routing_table: "isp9", distance: 200 }] } } },
        loopback: { lo: { addresses: ["192.0.2.1/32"] } },
        wireguard: { wg1: { listen_port: 51811, routing_table: "isp9", private_key: { secret: "WG" } } },
    },
    routing: { tables: Object.fromEntries(tables.map((table) => [table, {}])) },
    services: { upnp: { internal: ["lan9"], external: "lo" } },
});

beforeAll(async () => {
    writeFileSync(join(folder, "circuit.ts"), `export const net = circuit({ sites: { home: { description: "home" } } });\n`);
    mkdirSync(join(folder, "sites", "home"), { recursive: true });
    writeFileSync(
        join(folder, "sites", "home", "cpe-01.ts"),
        `import { net } from "../../circuit";\n\nexport default net.device(${JSON.stringify(router(["isp1"]), null, 4)});\n`
    );
    stopped = await readProject(folder).then(
        () => [],
        (error: unknown) => (error instanceof ProjectError ? error.lines : [String(error)])
    );
});

afterAll(() => rmSync(folder, { recursive: true, force: true }));

test("a table or an interface the device does not declare is named", () => {
    expect(stopped).toEqual([
        "sites/home/cpe-01.ts:24: cpe-01: interfaces.ethernet.1g-1.dhcp_client.default_routes[1].routing_table: no table isp9. Did you mean isp1?",
        "sites/home/cpe-01.ts:46: cpe-01: interfaces.wireguard.wg1.routing_table: no table isp9. Did you mean isp1?",
        "cpe-01: services.upnp.internal: no interface lan9",
    ]);
});

test("a table only a DHCP client fills is not empty", () => {
    const device = { ...router(["isp1"]), interfaces: { ethernet: router(["isp1"]).interfaces.ethernet } };
    const findings = Validation.run([JSON.parse(JSON.stringify(device))], undefined).map((finding) => finding.message);
    expect(findings.filter((message) => message.includes("nothing installs routes"))).toEqual([]);
});
