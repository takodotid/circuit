// QinQ on the three CHRs of the devices workflow. cpe-01, on the third, sends its VLAN 100 to sw-01, on the first. sw-01 puts it in VLAN 300 with a QinQ port, toward bng-01 on the second. bng-01 ends VLAN 100 inside VLAN 300 with a VLAN interface, so cpe-01 reaches it only while both tags are what bng-01 expects. Skipped without the three CHRs.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/** Each CHR's SSH, as `host:port`. Each has the user `operator`, with the password in CIRCUIT_TEST_CHR_PASSWORD. */
const switchChr = process.env.CIRCUIT_TEST_CHR;
const bngChr = process.env.CIRCUIT_TEST_CHR_B;
const cpeChr = process.env.CIRCUIT_TEST_CHR_C;
const password = process.env.CIRCUIT_TEST_CHR_PASSWORD ?? "";

const repo = join(import.meta.dir, "..", "..");
const folder = realpathSync(mkdtempSync(join(tmpdir(), "circuit-chr-qinq-")));

/** A test applies to up to three routers, and pings across. */
const TEST_MS = 300_000;

/** How long a ping has to get through after an apply. */
const WAIT_MS = 30_000;

const POLL_MS = 2000;

/** The service VLAN sw-01 puts cpe-01's frames in, and bng-01 takes them from. */
const SERVICE_VLAN = 300;

/** bng-01's and cpe-01's ends of the customer's VLAN. */
const BNG = "198.51.100.1";
const CPE = "198.51.100.2";

/** What each router is set to: the TPID of sw-01's and bng-01's ports, the customer's VLAN at each end, and bng-01's VLAN interface on the service VLAN without an address. */
type Lab = { switchTpid?: "0x88a8"; bngTpid?: "0x88a8"; cpeVlan: number; bngInner?: number; bngPlain?: true };

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

/** A device of the lab project on `chr`, managed on its first port, with its VLANs, its other ports, and its VLAN interfaces. */
function writeDevice(name: string, chr: string, management: string, vlans: string, ports: string, vlanInterfaces: string[] = []): void {
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
    management: { allow: ["${management}.0/24"], ssh: {} },
    switching: { vlans: { ${vlans} } },
    interfaces: {
        ethernet: {
            "virtual-1": { description: "Management", addresses: ["${management}.1/24"] },
            ${ports}
        },
        vlan_interface: { ${vlanInterfaces.join(", ")} },
    },
});
`
    );
}

/** The three routers as `lab` sets them. */
function writeLab(lab: Lab): void {
    const tpid = (value?: string) => (value ? `, tpid: "${value}"` : "");
    writeDevice(
        "sw-01",
        switchChr!,
        "10.0.0",
        `service: { id: ${SERVICE_VLAN} }`,
        `"virtual-2": { description: "bng-01", trunk_vlans: ["service"]${tpid(lab.switchTpid)} },
            "virtual-3": { description: "cpe-01", qinq_vlan: "service"${tpid(lab.switchTpid)} },`
    );
    writeDevice(
        "bng-01",
        bngChr!,
        "10.0.1",
        `service: { id: ${SERVICE_VLAN} }`,
        `"virtual-2": { description: "sw-01", trunk_vlans: ["service"]${tpid(lab.bngTpid)} },`,
        [
            ...(lab.bngPlain ? [`"service-gw": { vlan: "service" }`] : []),
            ...(lab.bngInner ? [`customer: { vlan: "service", inner_vlan_id: ${lab.bngInner}, addresses: ["${BNG}/30"] }`] : []),
        ]
    );
    writeDevice(
        "cpe-01",
        cpeChr!,
        "10.0.2",
        `customer: { id: ${lab.cpeVlan} }`,
        `"virtual-2": { description: "sw-01", trunk_vlans: ["customer"] },`,
        [`wan: { vlan: "customer", addresses: ["${CPE}/30"] }`]
    );
}

/** What `exec` printed for `commands` on `device`. */
function exec(device: string, ...commands: string[]): string {
    const { status, output } = circuit("exec", device, ...commands);
    expect(status).toBe(0);
    return output;
}

/** Whether cpe-01 reaches bng-01 across sw-01. */
function reaches(): boolean {
    return /received=[1-9]/.test(exec("cpe-01", `/ping ${BNG} count=3`));
}

/** Whether cpe-01 reaches bng-01 within `WAIT_MS`. */
function eventuallyReaches(): boolean {
    const deadline = Date.now() + WAIT_MS;
    while (!reaches()) {
        if (Date.now() > deadline) return false;
        Bun.sleepSync(POLL_MS);
    }
    return true;
}

/** Applies to each router named, and finds nothing to change after. */
function apply(...names: string[]): void {
    for (const name of names) {
        // A diff first: the first export after a boot leaves out what the apply's read would then miss (TRAPS.md).
        circuit("diff", name);
        expect(circuit("apply", name, "--confirm").status).toBe(0);
        expect(circuit("diff", name).status).toBe(0);
    }
}

/** What each router holds of its bridge and VLAN interfaces, for the job's log. */
function logTags(): void {
    for (const name of ["sw-01", "bng-01", "cpe-01"]) exec(name, "/interface bridge export", "/interface vlan export");
}

describe.skipIf(!switchChr || !bngChr || !cpeChr)("QinQ across three CHRs", () => {
    beforeAll(() => {
        write("circuit.ts", `export const lab = circuit({ sites: { lab: { description: "Three CHRs, linked port to port." } } });\n`);
    });

    afterAll(() => rmSync(folder, { recursive: true, force: true }));

    test(
        "with 802.1ad's TPID on sw-01 and bng-01, bng-01 ends the customer's VLAN inside the service VLAN, and cpe-01 reaches it",
        () => {
            writeLab({ switchTpid: "0x88a8", bngTpid: "0x88a8", cpeVlan: 100, bngInner: 100 });
            apply("sw-01", "bng-01", "cpe-01");
            const reached = eventuallyReaches();
            logTags();
            expect(reached).toBe(true);
            expect(exec("bng-01", "/interface vlan export")).toContain("add interface=bridge name=service use-service-tag=yes vlan-id=300");
        },
        TEST_MS
    );

    test(
        "with 802.1Q's TPID on bng-01 alone, it takes none of sw-01's frames, and with it on both, cpe-01 reaches bng-01 again",
        () => {
            writeLab({ switchTpid: "0x88a8", cpeVlan: 100, bngInner: 100 });
            apply("bng-01");
            expect(reaches()).toBe(false);

            writeLab({ cpeVlan: 100, bngInner: 100 });
            apply("sw-01");
            const reached = eventuallyReaches();
            logTags();
            expect(reached).toBe(true);
        },
        TEST_MS
    );

    test(
        "the customer's VLAN reaches bng-01 only when its inner VLAN matches, after each is changed",
        () => {
            writeLab({ switchTpid: "0x88a8", bngTpid: "0x88a8", cpeVlan: 101, bngInner: 100 });
            apply("sw-01", "bng-01", "cpe-01");
            expect(reaches()).toBe(false);

            writeLab({ switchTpid: "0x88a8", bngTpid: "0x88a8", cpeVlan: 101, bngInner: 101 });
            apply("bng-01");
            const reached = eventuallyReaches();
            logTags();
            expect(reached).toBe(true);
        },
        TEST_MS
    );

    test(
        "bng-01 ends the inner VLAN on a plain VLAN interface of the service VLAN once it has one",
        () => {
            writeLab({ switchTpid: "0x88a8", bngTpid: "0x88a8", cpeVlan: 101, bngInner: 101, bngPlain: true });
            apply("bng-01");
            const reached = eventuallyReaches();
            logTags();
            expect(reached).toBe(true);
            expect(exec("bng-01", "/interface vlan export")).toContain("add interface=service-gw name=customer vlan-id=101");
        },
        TEST_MS
    );

    test(
        "without the VLAN interfaces and the TPID, each apply removes them, and no VLAN interface is left on nothing",
        () => {
            writeLab({ cpeVlan: 101 });
            apply("sw-01", "bng-01");
            logTags();
            const left = exec("bng-01", "/interface vlan print count-only", "/interface bridge export");
            expect(left).not.toContain("ether-type");
            expect(left).toMatch(/^0$/m);
        },
        TEST_MS
    );
});
