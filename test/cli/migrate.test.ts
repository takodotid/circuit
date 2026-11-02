// `circuit migrate` on Circuit 0.x's examples: each example's devices, as 0.x held them, become a v1 project that the editor's types take, in TypeScript 6 and 7, and that Circuit reads back into the same devices as the golden fixtures.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Migrate } from "../../src/cli/migrate";
import { readProject } from "../../src/project/project";
import { Fixtures } from "../fixtures";

const parent = mkdtempSync(join(tmpdir(), "circuit-migrate-"));
const root = join(import.meta.dir, "..", "..");

/** Each example's fixtures, by the example's name: the part of a fixture's name before `--`. */
const examples = new Map<string, string[]>();
for (const name of Fixtures.names()) {
    const example = name.split("--")[0]!;
    examples.set(example, [...(examples.get(example) ?? []), name]);
}

const v0 = (name: string) => JSON.parse(readFileSync(join(Fixtures.FOLDER, `${name}.v0.json`), "utf8"));

/** A device with each certificate's path swapped for the certificate's text, so two projects that keep the files apart compare. */
function withCertificateTexts(device: any, folder: string): any {
    const certificates = device.system?.certificates;
    if (!certificates) return device;

    const texts = Object.fromEntries(
        Object.entries<any>(certificates).map(([key, value]) => [
            key,
            { ...value, certificate_file: readFileSync(join(folder, value.certificate_file), "utf8") },
        ])
    );
    return { ...device, system: { ...device.system, certificates: texts } };
}

beforeAll(() => {
    for (const [example, names] of examples) {
        const migrated = Migrate.convert({ asn: 64500, devices: names.map(v0), site: () => example });
        Migrate.write(join(parent, example), migrated, { root: parent, copyEnv: false });
    }
});

afterAll(() => rmSync(parent, { recursive: true, force: true }));

test("every example became a project", () => {
    expect(readdirSync(parent).sort()).toEqual([...examples.keys()].sort());
});

describe.each([...examples.keys()])("%s", (example) => {
    const folder = join(parent, example);

    for (const [version, tsc] of [
        ["7", join(root, "node_modules", "typescript", "bin", "tsc")],
        ["6", join(root, "node_modules", "typescript-6", "bin", "tsc")],
    ] as const) {
        test(`the editor's types take it, in TypeScript ${version}`, () => {
            const run = spawnSync("bun", [tsc, "--noEmit", "-p", folder], { encoding: "utf8" });
            expect(run.stdout + run.stderr).toBe("");
        });
    }

    test("Circuit reads back the golden fixtures' devices", async () => {
        const read = await readProject(folder);
        const devices = read.networks[0]!.devices;

        for (const name of examples.get(example)!) {
            const fixture = Fixtures.device(name);
            expect(withCertificateTexts(devices[fixture.name], folder)).toEqual(withCertificateTexts(fixture, Fixtures.FOLDER));
        }
    });
});

test("secrets are written as secret(), keys bare, short values on one line, long ones over lines", () => {
    expect(Migrate.print({ password: { secret: "EDGE_PASSWORD" }, key: { secret_file: "keys/edge.pem" } })).toBe(
        '{ password: secret("EDGE_PASSWORD"), key: secretFile("keys/edge.pem") }'
    );
    expect(Migrate.print({ "10g-1": { trunk_vlans: ["a", "b"] }, description: "x".repeat(90) })).toBe(
        `{
    "10g-1": { trunk_vlans: ["a", "b"] },
    description: "${"x".repeat(90)}",
}`
    );
});

test("what did not move is listed: the site, own checks, the communities", () => {
    const own = () => [];
    const migrated = Migrate.convert({
        asn: 64500,
        devices: [v0("single-site--router")],
        checks: [own],
        communities: [{ community: "64500:100", description: "learned from a transit" }],
    });
    const report = Migrate.report(migrated, []);

    expect(migrated.devices[0]!.site).toBe(Migrate.DEFAULT_SITE);
    expect(report).toContain("every device is at `site-1`");
    expect(report).toContain("1 check(s) in `checks` are your own");
    expect(report).toContain("`64500:100`: learned from a transit");
});

test("a built-in check of 0.x becomes v1's", () => {
    const exportsEndInReject = () => [];
    const migrated = Migrate.convert(
        { asn: 64500, devices: [v0("single-site--router")], checks: [exportsEndInReject] },
        { exportsEndInReject }
    );

    expect(migrated.settings.checks).toEqual({ exports_end_in_reject: true });
    expect(migrated.notes[""]!.some((note) => note.includes("your own"))).toBe(false);
});
