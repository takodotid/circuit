// A secret is always a reference, `secret("NAME")` or `secretFile("path")`. A password written as plain text in a device file or in circuit.ts stops `circuit validate`, which names the file, the line, and the key, and never repeats the text.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectError, Project } from "../../src/project";

const folder = realpathSync(mkdtempSync(join(tmpdir(), "circuit-plain-secrets-")));
let stopped: string[] = [];

beforeAll(async () => {
    writeFileSync(
        join(folder, "circuit.ts"),
        [
            "export const net = circuit({",
            '    sites: { home: { description: "Home" } },',
            '    secrets: { file: ".circuit/lab-secrets" },',
            '    integrations: { peeringdb: { api_key: "pdb-key-1" } },',
            "});",
            "",
        ].join("\n")
    );
    mkdirSync(join(folder, "sites", "home"), { recursive: true });
    writeFileSync(
        join(folder, "sites", "home", "router.ts"),
        [
            'import { net } from "../../circuit";',
            "",
            "export default net.device({",
            '    name: "router",',
            '    site: "home",',
            '    platform: "routeros",',
            '    model: "RB5009UG+S+",',
            '    connection: { host: "192.168.88.1", user: "admin" },',
            "    system: {",
            '        users: { admin: { role: "admin", password: "hunter2" } },',
            "    },",
            "    monitoring: {",
            '        snmp: { users: { librenms: { auth: "sha256", auth_password: secret("SNMP_AUTH") } } },',
            "    },",
            "});",
            "",
        ].join("\n")
    );
    stopped = await Project.read(folder).then(
        () => [],
        (error: unknown) => (error instanceof ProjectError ? error.lines : [String(error)])
    );
});

afterAll(() => rmSync(folder, { recursive: true, force: true }));

test("a secret written as plain text is named, with what to write instead", () => {
    expect(stopped).toEqual([
        `circuit.ts:4: integrations.peeringdb.api_key: a secret can't be written as plain text. Write secret("NAME") instead, and set its value with circuit secrets set NAME --file .circuit/lab-secrets.`,
        `sites/home/router.ts:10: router: system.users.admin.password: a secret can't be written as plain text. Write secret("NAME") instead, and set its value with circuit secrets set NAME --file .circuit/lab-secrets.`,
    ]);
    expect(stopped.join("\n")).not.toContain("hunter2");
    expect(stopped.join("\n")).not.toContain("pdb-key-1");
});
