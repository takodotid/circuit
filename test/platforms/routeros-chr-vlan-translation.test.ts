// Three RouterOS CHRs, which the devices workflow boots, the first linked to the other two. r-02 tags a VLAN with its own ID, which r-01 translates into the VLAN r-03 and r-01 call core. Skipped without the three CHRs.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/** Each CHR's SSH, as `host:port`. Each has the user `operator`, with the password in CIRCUIT_TEST_CHR_PASSWORD. */
const firstChr = process.env.CIRCUIT_TEST_CHR;
const secondChr = process.env.CIRCUIT_TEST_CHR_B;
const thirdChr = process.env.CIRCUIT_TEST_CHR_C;
const password = process.env.CIRCUIT_TEST_CHR_PASSWORD ?? "";

const repo = join(import.meta.dir, "..", "..");
const folder = realpathSync(mkdtempSync(join(tmpdir(), "circuit-chr-vlan-translation-")));

/** A test applies to three routers. */
const TEST_MS = 300_000;

/** A first ping waits for ARP, so one that should answer is tried again. */
const TRIES = 3;

/** The VLAN core, in each router: r-01's and r-03's VLAN interface, and r-02's on the VLAN it tags with its own ID. */
const CORE = { first: "203.0.113.1", second: "203.0.113.2", third: "203.0.113.3" };
/** A VLAN the trunk carries tagged as it is, and its native VLAN. */
const OFFICE = { first: "198.51.100.1", second: "198.51.100.2" };
const NATIVE = { first: "192.0.2.1", second: "192.0.2.2" };
/** r-02's VLAN with core's own ID, which r-01's trunk does not carry. */
const OWN = { first: "192.0.2.129", second: "192.0.2.130" };

/** Runs Circuit from the sources in the lab project, and prints what it printed, so the job's log shows each plan. */
function circuit(...args: string[]): { status: number | null; output: string } {
    const run = spawnSync("bun", [join(repo, "src", "cli", "index.ts"), ...args], {
        cwd: folder,
        encoding: "utf8",
        env: { ...process.env, OPERATOR_PASSWORD: password },
    });
    const output = `${run.stdout}${run.stderr}`;
    console.log(`$ circuit ${args.join(" ")}\n${output}`);
    return { status: run.status, output };
}

/** A file of the lab project. */
function write(path: string, text: string): void {
    mkdirSync(dirname(join(folder, path)), { recursive: true });
    writeFileSync(join(folder, path), text);
}

/** A device of the lab project on `chr`, with these groups. */
function writeDevice(name: string, chr: string, groups: string): void {
    const [host, port] = chr.split(":");
    write(
        `sites/lab/${name}.ts`,
        `import { lab } from "../../circuit";

export default lab.device({
    name: "${name}",
    site: "lab",
    platform: "routeros",
    model: "CHR",
    connection: { host: "${host}", port: ${port}, user: "operator" },
    system: { users: { operator: { role: "admin", password: secret("OPERATOR_PASSWORD") } } },
    ${groups}
});
`
    );
}

/** r-01, whose trunk to r-02 carries core as `from`, or no core at all without it. */
function writeFirst(from?: number): void {
    const core = from === undefined ? "" : `"core", `;
    const translation = from === undefined ? "" : `vlan_translation: [{ from: ${from}, to: "core" }]`;
    writeDevice(
        "r-01",
        firstChr!,
        `management: { allow: ["10.0.0.0/24"], ssh: {} },
    interfaces: {
        ethernet: {
            "virtual-1": { description: "Management", addresses: ["10.0.0.1/24"] },
            "virtual-2": { description: "r-02", trunk_vlans: [${core}"office"], native_vlan: "native", ${translation} },
            "virtual-3": { description: "r-03", trunk_vlans: ["core"] },
        },
        vlan_interface: {
            core: { vlan: "core", addresses: ["${CORE.first}/24", "${OWN.first}/25"] },
            office: { vlan: "office", addresses: ["${OFFICE.first}/24"] },
            native: { vlan: "native", addresses: ["${NATIVE.first}/25"] },
        },
    },
    switching: { vlans: { core: { id: 100 }, office: { id: 40 }, native: { id: 30 } } },`
    );
}

/** r-02, which tags core with `from`, and has a VLAN of its own with core's ID. */
function writeSecond(from: number): void {
    writeDevice(
        "r-02",
        secondChr!,
        `management: { allow: ["10.0.1.0/24"], ssh: {} },
    interfaces: {
        ethernet: {
            "virtual-1": { description: "Management", addresses: ["10.0.1.1/24"] },
            "virtual-2": { description: "r-01", trunk_vlans: ["far", "office", "own"], native_vlan: "native" },
        },
        vlan_interface: {
            far: { vlan: "far", addresses: ["${CORE.second}/24"] },
            office: { vlan: "office", addresses: ["${OFFICE.second}/24"] },
            own: { vlan: "own", addresses: ["${OWN.second}/25"] },
            native: { vlan: "native", addresses: ["${NATIVE.second}/25"] },
        },
    },
    switching: { vlans: { far: { id: ${from} }, office: { id: 40 }, own: { id: 100 }, native: { id: 30 } } },`
    );
}

/** What `exec` printed for `command` on `device`. */
function exec(device: string, command: string): string {
    const { status, output } = circuit("exec", device, command);
    expect(status).toBe(0);
    return output;
}

/** Whether r-02 reaches `address`, trying `tries` times. */
function reaches(address: string, tries = TRIES): boolean {
    for (let attempt = 0; attempt < tries; attempt++) if (/received=[1-9]/.test(exec("r-02", `/ping ${address} count=3`))) return true;
    return false;
}

describe.skipIf(!firstChr || !secondChr || !thirdChr)("a CHR translates a VLAN on a trunk with a VLAN interface on the port", () => {
    beforeAll(() => {
        write("circuit.ts", `export const lab = circuit({ sites: { lab: { description: "Three CHRs, linked port to port." } } });\n`);
        writeFirst(20);
        writeSecond(20);
        writeDevice(
            "r-03",
            thirdChr!,
            `management: { allow: ["10.0.2.0/24"], ssh: {} },
    interfaces: {
        ethernet: {
            "virtual-1": { description: "Management", addresses: ["10.0.2.1/24"] },
            "virtual-2": { description: "r-01", trunk_vlans: ["core"] },
        },
        vlan_interface: { core: { vlan: "core", addresses: ["${CORE.third}/24"] } },
    },
    switching: { vlans: { core: { id: 100 } } },`
        );
    });

    afterAll(() => rmSync(folder, { recursive: true, force: true }));

    test(
        "r-02's VLAN 20 reaches core on r-01 and r-03, beside a tagged VLAN and the native one, and no frame of VLAN 100 crosses as it is",
        () => {
            for (const device of ["r-02", "r-03", "r-01"]) {
                circuit("diff", device);
                expect(circuit("apply", device, "--confirm").status).toBe(0);
                expect(circuit("diff", device).status).toBe(0);
            }
            exec("r-01", "/interface bridge port print detail without-paging");

            expect(reaches(CORE.first)).toBe(true);
            expect(reaches(CORE.third)).toBe(true);
            expect(reaches(OFFICE.first)).toBe(true);
            expect(reaches(NATIVE.first)).toBe(true);
            expect(reaches(OWN.first, 1)).toBe(false);
        },
        TEST_MS
    );

    test(
        "with another ID on the cable, apply moves the translation to it, and diff then finds nothing to change",
        () => {
            writeFirst(21);
            writeSecond(21);
            for (const device of ["r-01", "r-02"]) {
                expect(circuit("apply", device, "--confirm").status).toBe(0);
                expect(circuit("diff", device).status).toBe(0);
            }
            exec("r-01", "/interface vlan print detail without-paging");

            expect(reaches(CORE.first)).toBe(true);
            expect(reaches(CORE.third)).toBe(true);
        },
        TEST_MS
    );

    test(
        "without the translation, apply removes its VLAN interface, and r-02 reaches core no more",
        () => {
            writeFirst();
            expect(circuit("apply", "r-01", "--confirm").status).toBe(0);
            expect(circuit("diff", "r-01").status).toBe(0);
            expect(exec("r-01", ":put [:len [/interface vlan find where interface=ether2]]")).toMatch(/^0$/m);

            expect(reaches(CORE.first, 1)).toBe(false);
            expect(reaches(OFFICE.first)).toBe(true);
        },
        TEST_MS
    );
});
