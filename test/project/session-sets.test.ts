// An interface set that a PPPoE server's sessions join stays a set in the model, since the device names each session's interface only when it comes up. Other sets are written out as their interfaces.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Project } from "../../src/project";
import type { ProjectRead } from "../../src/project";

const folder = mkdtempSync(join(tmpdir(), "circuit-session-sets-"));
let read: ProjectRead;

const radius = [{ address: "192.0.2.10", secret_key: { secret: "RADIUS" } }];

const bng = {
    name: "bng-01",
    site: "test",
    platform: "routeros",
    model: "CCR2216-1G-12XS-2XQ",
    connection: { host: "10.0.10.1", user: "admin" },
    system: { users: { admin: { role: "admin", password: { secret: "PASSWORD" } } } },
    interfaces: { ethernet: { "25g-1": {}, "25g-2": {}, "25g-3": {} } },
    services: {
        pppoe_server: {
            "olt-1": {
                interfaces: ["25g-3"],
                local_address: "100.64.0.1",
                pool: ["100.64.0.2", "100.64.63.254"],
                mtu: 1492,
                radius,
                interface_set: "subscribers",
            },
        },
    },
    firewall: {
        interface_sets: { subscribers: [], uplinks: ["25g-1", "25g-2"] },
        filter: {
            input: { rules: [{ description: "No subscriber reaches the router", if: { in_interface_set: "subscribers" }, then: "drop" }] },
            forward: {
                rules: [
                    {
                        description: "Subscribers out",
                        if: { in_interface_set: "subscribers", out_interface_set: "uplinks" },
                        then: "accept",
                    },
                ],
            },
        },
    },
};

beforeAll(async () => {
    writeFileSync(join(folder, "circuit.ts"), `export const net = circuit({ asn: 64500, sites: { test: { description: "test" } } });\n`);
    mkdirSync(join(folder, "sites", "test"), { recursive: true });
    writeFileSync(
        join(folder, "sites", "test", "bng-01.ts"),
        `import { net } from "../../circuit";\n\nexport default net.device(${JSON.stringify(bng, null, 4)});\n`
    );
    read = await Project.read(folder);
});

afterAll(() => rmSync(folder, { recursive: true, force: true }));

test("a set the sessions join stays a set, and another is written out as its interfaces", () => {
    const firewall = read.networks[0]?.devices["bng-01"]?.firewall;

    expect(firewall?.interface_sets).toEqual({ subscribers: [] });
    expect(firewall?.filter?.input?.rules).toEqual([
        { description: "No subscriber reaches the router", if: { in_interface_set: "subscribers" }, then: "drop" },
    ]);
    expect(firewall?.filter?.forward?.rules).toEqual([
        { description: "Subscribers out", if: { in_interface_set: "subscribers", out_interface: "25g-1" }, then: "accept" },
        { description: "Subscribers out", if: { in_interface_set: "subscribers", out_interface: "25g-2" }, then: "accept" },
    ]);
});
