// A firewall rule whose `src` and `dst` lists hold both families: each src and dst of different families matches no packet, so reading the
// project leaves that combination out. A rule that has nothing else is reported. RouterOS refuses an IPv6 dst on its IPv4 filter, and a
// refused command mid-apply restores the backup and reboots the router.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Validation } from "../../src/checks";
import { type ProjectRead, readProject } from "../../src/project/project";

const folder = mkdtempSync(join(tmpdir(), "circuit-rule-families-"));
let read: ProjectRead;

const router = {
    name: "r1",
    site: "test",
    platform: "routeros",
    model: "CCR2216-1G-12XS-2XQ",
    connection: { host: "10.0.10.1", user: "admin" },
    system: { users: { admin: { role: "admin", password: { secret: "PASSWORD" } } } },
    firewall: {
        filter: {
            forward: {
                rules: [
                    { description: "operators", if: { src: "10.0.20.0/24", dst: ["192.0.2.2/32", "2001:db8::2/128"] }, then: "accept" },
                    { description: "nothing else", if: { dst: ["192.0.2.2/32", "2001:db8::2/128"] }, then: "drop" },
                    { description: "never", if: { src: "10.0.20.0/24", dst: "2001:db8::2/128" }, then: "accept" },
                ],
            },
        },
    },
};

beforeAll(async () => {
    writeFileSync(join(folder, "circuit.ts"), `export const net = circuit({ asn: 64500, sites: { test: { description: "test" } } });\n`);
    mkdirSync(join(folder, "sites", "test"), { recursive: true });
    writeFileSync(
        join(folder, "sites", "test", "r1.ts"),
        `import { net } from "../../circuit";\n\nexport default net.device(${JSON.stringify(router, null, 4)});\n`
    );
    read = await readProject(folder);
});

afterAll(() => rmSync(folder, { recursive: true, force: true }));

test("a src and a dst of different families are left out, and a rule with nothing else is reported", () => {
    const device = read.networks[0]?.devices.r1;
    expect(device?.firewall?.filter?.forward?.rules).toEqual([
        { description: "operators", if: { src: "10.0.20.0/24", dst: "192.0.2.2/32" }, then: "accept" },
        { description: "nothing else", if: { dst: "192.0.2.2/32" }, then: "drop" },
        { description: "nothing else", if: { dst: "2001:db8::2/128" }, then: "drop" },
        { description: "never", if: { src: "10.0.20.0/24", dst: "2001:db8::2/128" }, then: "accept" },
    ]);

    const messages = device ? Validation.run([device], undefined).map((finding) => finding.message) : [];
    expect(messages).toContain("firewall.filter.forward.rules (never): src and dst differ in family, so no packet matches both");
    expect(messages.filter((message) => message.includes("differ in family"))).toHaveLength(1);
});
