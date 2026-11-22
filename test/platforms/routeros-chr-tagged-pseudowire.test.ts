// A pseudowire between the second and the third CHR of the devices workflow, set up as in routeros-chr-pseudowire.test.ts. First it carries two VLANs and a QinQ VLAN, each frame with its tags. Then it is a QinQ port, then an access port again, and last it goes. Skipped without the three CHRs.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/** Each CHR's SSH, as `host:port`. Each has the user `operator`, with the password in CIRCUIT_TEST_CHR_PASSWORD. */
const pChr = process.env.CIRCUIT_TEST_CHR;
const firstPeChr = process.env.CIRCUIT_TEST_CHR_B;
const secondPeChr = process.env.CIRCUIT_TEST_CHR_C;
const password = process.env.CIRCUIT_TEST_CHR_PASSWORD ?? "";

const repo = join(import.meta.dir, "..", "..");
const folder = realpathSync(mkdtempSync(join(tmpdir(), "circuit-chr-tagged-pseudowire-")));

/** A test applies to two or three routers, and waits for OSPF, LDP, and the pseudowire. */
const TEST_MS = 300_000;

/** How long the pseudowire has to come up. */
const WAIT_MS = 90_000;

const POLL_MS = 3000;

/** The MTU of a VLAN interface on a bridge where a pseudowire runs, which RouterOS lowers it to (TRAPS.md). */
const VLAN_MTU = 1496;

/** The MTU of a VLAN interface inside the QinQ VLAN: a tag less than its outer one. */
const INNER_MTU = 1492;

/** The pseudowire's PW ID. */
const PW_ID = 210;

/** The two VLANs a trunk pseudowire carries, the QinQ VLAN, and the customer's VLAN inside it. */
const VLANS = { first: 210, second: 211, qinq: 300 };
const CUSTOMER_VLAN = 10;

/** PW types in the PWid FEC (RFC 8077, section 5.2), as `/mpls ldp local-mapping print detail` prints it: `pw-fec=8000040800...` is type 4, Ethernet tagged mode, and `8000050800...` type 5, Ethernet. */
const TAGGED_FEC = /\bpw-fec=800004/;
const RAW_FEC = /\bpw-fec=800005/;

/** How the pseudowire carries the VLANs. */
type Mode = "trunk" | "qinq" | "access";

/** One router of the lab: its name, CHR, management network, loopback, links, and its address in each VLAN. */
type Router = {
    name: string;
    chr: string;
    management: string;
    loopback: string;
    links: Record<string, string>;
    first?: string;
    second?: string;
    customer?: string;
};

const P: Router = {
    name: "p-01",
    chr: pChr!,
    management: "10.0.0",
    loopback: "192.0.2.101",
    links: { "virtual-2": "192.0.2.17", "virtual-3": "192.0.2.21" },
};
const FIRST_PE: Router = {
    name: "pe-01",
    chr: firstPeChr!,
    management: "10.0.1",
    loopback: "192.0.2.102",
    links: { "virtual-2": "192.0.2.18" },
    first: "198.51.100.1",
    second: "198.51.100.65",
    customer: "198.51.100.129",
};
const SECOND_PE: Router = {
    name: "pe-02",
    chr: secondPeChr!,
    management: "10.0.2",
    loopback: "192.0.2.103",
    links: { "virtual-2": "192.0.2.22" },
    first: "198.51.100.2",
    second: "198.51.100.66",
    customer: "198.51.100.130",
};
const ROUTERS = [P, FIRST_PE, SECOND_PE];
const PES = [FIRST_PE, SECOND_PE];

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

/** Whether `check` holds within `WAIT_MS`, asking every `POLL_MS`. */
function eventually(check: () => boolean): boolean {
    const deadline = Date.now() + WAIT_MS;
    while (!check()) {
        if (Date.now() > deadline) return false;
        Bun.sleepSync(POLL_MS);
    }
    return true;
}

/** A file of the lab project. */
function write(path: string, text: string): void {
    mkdirSync(dirname(join(folder, path)), { recursive: true });
    writeFileSync(join(folder, path), text);
}

/** How the pseudowire is a port in each mode. */
const MEMBERSHIP: Record<Mode, string> = {
    trunk: `trunk_vlans: ["first", "second", "qinq"]`,
    qinq: `qinq_vlan: "qinq"`,
    access: `access_vlan: "first"`,
};

/** A router of the lab. A PE has the VLANs, each with an interface, and the customer's VLAN inside the QinQ VLAN. With `mode`, it has a pseudowire to the other PE. */
function writeRouter(router: Router, mode: Mode | undefined): void {
    const [host, port] = router.chr.split(":");
    const ports = Object.entries(router.links)
        .map(([link, address]) => `"${link}": { description: "lab link", addresses: ["${address}/30"] },`)
        .join("\n            ");
    const ospf = Object.keys(router.links)
        .map((link) => `"${link}": { network: "point-to-point" },`)
        .join(" ");

    const far = router === FIRST_PE ? SECOND_PE : FIRST_PE;
    const pe = router !== P;
    const vlans = pe ? `first: { id: ${VLANS.first} }, second: { id: ${VLANS.second} }, qinq: { id: ${VLANS.qinq} }` : "";
    const vlanInterfaces = pe
        ? `"vlan-first": { vlan: "first", mtu: ${VLAN_MTU}, addresses: ["${router.first}/26"] },
            "vlan-second": { vlan: "second", mtu: ${VLAN_MTU}, addresses: ["${router.second}/26"] },
            "vlan-qinq": { vlan: "qinq", mtu: ${VLAN_MTU} },
            "vlan-customer": { vlan: "qinq", inner_vlan_id: ${CUSTOMER_VLAN}, mtu: ${INNER_MTU}, addresses: ["${router.customer}/26"] },`
        : "";
    const pseudowire = pe && mode ? `"pw-tagged": { peer: "${far.loopback}", pw_id: ${PW_ID}, ${MEMBERSHIP[mode]} }` : "";

    write(
        `sites/lab/${router.name}.ts`,
        `import { lab } from "../../circuit";

export default lab.device({
    name: "${router.name}",
    site: "lab",
    platform: "routeros",
    model: "CHR",
    connection: { host: "${host}", port: ${port}, user: "operator" },
    system: { users: { operator: { role: "admin", password: secret("OPERATOR_PASSWORD") } } },
    management: { allow: ["${router.management}.0/24"], ssh: {} },
    interfaces: {
        ethernet: {
            "virtual-1": { description: "Management", addresses: ["${router.management}.1/24"] },
            ${ports}
        },
        loopback: { loopback: { addresses: ["${router.loopback}/32"] } },
        vlan_interface: {
            ${vlanInterfaces}
        },
        pseudowire: { ${pseudowire} },
    },
    switching: { vlans: { ${vlans} } },
    routing: {
        router_id: "${router.loopback}",
        ospf: { areas: { "0.0.0.0": { interfaces: { loopback: { passive: true }, ${ospf} } } } },
        mpls: { ldp: { lsr_id: "${router.loopback}", interfaces: ${JSON.stringify(Object.keys(router.links))} } },
    },
});
`
    );
}

/** The routers, the pseudowire in `mode`, or none. */
function writeLab(mode: Mode | undefined): void {
    for (const router of ROUTERS) writeRouter(router, mode);
}

/** What `exec` printed for `commands` on `device`. */
function exec(device: string, ...commands: string[]): string {
    const { status, output } = circuit("exec", device, ...commands);
    expect(status).toBe(0);
    return output;
}

/** Whether `device` runs the pseudowire, flagged `R` in `/interface vpls print detail`. */
function running(device: string): boolean {
    return /^\s*\d+\s+[A-Z]*R[A-Z]*\s+name="pw-tagged"/m.test(exec(device, "/interface vpls print detail without-paging"));
}

/** The PWid FECs `device` sent for its pseudowires, as `/mpls ldp local-mapping print detail` prints them. */
function sentFec(device: string): string {
    return exec(device, "/mpls ldp local-mapping print detail without-paging");
}

/** Whether `device` reaches `address`. */
function pings(device: string, address: string): boolean {
    return /received=[1-9]/.test(exec(device, `/ping ${address} count=3`));
}

/** What each PE holds of its pseudowire and bridge, for the job's log. */
function logPseudowire(): void {
    for (const { name } of PES)
        exec(
            name,
            "/interface vpls print detail without-paging",
            "/interface bridge port print detail without-paging",
            "/interface bridge vlan print detail without-paging"
        );
}

/** Applies to each PE, and finds nothing to change after. */
function applyPes(): void {
    for (const { name } of PES) {
        expect(circuit("apply", name, "--confirm").status).toBe(0);
        expect(circuit("diff", name).status).toBe(0);
    }
}

describe.skipIf(!pChr || !firstPeChr || !secondPeChr)("a pseudowire that carries tagged VLANs, then a QinQ VLAN", () => {
    beforeAll(() => {
        write("circuit.ts", `export const lab = circuit({ sites: { lab: { description: "Three CHRs, linked port to port." } } });\n`);
        writeLab("trunk");
    });

    afterAll(() => rmSync(folder, { recursive: true, force: true }));

    test(
        "a trunk pseudowire is tagged mode, PW type 4, and each VLAN's frames cross with their tag into the same VLAN at the far PE",
        () => {
            for (const { name } of ROUTERS) {
                // A diff first: the first export after a boot leaves out what the apply's read would then miss (TRAPS.md).
                circuit("diff", name);
                expect(circuit("apply", name, "--confirm").status).toBe(0);
                expect(circuit("diff", name).status).toBe(0);
            }
            const up = eventually(() => running(FIRST_PE.name) && running(SECOND_PE.name));
            logPseudowire();
            expect(up).toBe(true);
            expect(sentFec(FIRST_PE.name)).toMatch(TAGGED_FEC);

            // Two VLANs on one pseudowire reach only their own VLAN at the far PE, so each frame kept its tag. The customer's VLAN crosses inside the QinQ VLAN with both tags.
            expect(eventually(() => pings(FIRST_PE.name, SECOND_PE.first!))).toBe(true);
            expect(eventually(() => pings(FIRST_PE.name, SECOND_PE.second!))).toBe(true);
            expect(eventually(() => pings(FIRST_PE.name, SECOND_PE.customer!))).toBe(true);
            for (const { name } of ROUTERS) expect(circuit("diff", name).status).toBe(0);
        },
        TEST_MS
    );

    test(
        "a QinQ pseudowire is raw mode, PW type 5, and the customer's tagged frames cross inside the QinQ VLAN",
        () => {
            writeLab("qinq");
            applyPes();
            const up = eventually(() => running(FIRST_PE.name) && running(SECOND_PE.name));
            logPseudowire();
            expect(up).toBe(true);
            expect(eventually(() => RAW_FEC.test(sentFec(FIRST_PE.name)))).toBe(true);
            expect(eventually(() => pings(FIRST_PE.name, SECOND_PE.customer!))).toBe(true);
            for (const { name } of PES) expect(circuit("diff", name).status).toBe(0);
        },
        TEST_MS
    );

    test(
        "back to an access port, the pseudowire is raw mode again and carries its VLAN untagged",
        () => {
            writeLab("access");
            applyPes();
            const up = eventually(() => running(FIRST_PE.name) && running(SECOND_PE.name));
            logPseudowire();
            expect(up).toBe(true);
            expect(eventually(() => pings(FIRST_PE.name, SECOND_PE.first!))).toBe(true);
            for (const { name } of PES) expect(circuit("diff", name).status).toBe(0);
        },
        TEST_MS
    );

    test(
        "without the pseudowire, each apply removes it and its bridge port, and diff then finds nothing to change",
        () => {
            writeLab(undefined);
            for (const { name } of PES) {
                expect(circuit("apply", name, "--confirm").status).toBe(0);
                expect(circuit("diff", name).status).toBe(0);
                expect(exec(name, "/interface vpls export")).not.toMatch(/^add /m);
            }
        },
        TEST_MS
    );
});
