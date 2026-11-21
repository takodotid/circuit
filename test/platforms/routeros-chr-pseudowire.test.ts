// Ethernet pseudowires on the three CHRs of the devices workflow. OSPF carries the loopbacks and LDP labels them, as in routeros-chr-mpls.test.ts. A pseudowire joins one VLAN of the second and the third (VPWS), then with an MTU of its own and the control word. Then all three join another VLAN with a pseudowire to each other (VPLS). Skipped without the three CHRs.

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
const folder = realpathSync(mkdtempSync(join(tmpdir(), "circuit-chr-pseudowire-")));

/** A test applies to three routers, and waits for OSPF, LDP, and the pseudowires. */
const TEST_MS = 300_000;

/** How long the pseudowires have to come up. */
const WAIT_MS = 90_000;

const POLL_MS = 3000;

/** The MTU of a VLAN interface on a bridge where a pseudowire runs, which RouterOS lowers it to (TRAPS.md). */
const VLAN_MTU = 1496;

/** An MTU of the VPWS's own, above the 1500 RouterOS tells the far PE when it has none, and the control word. */
const SIGNALED = { mtu: 1508, control_word: true };

/**
 * The PWid FEC element (RFC 8077, section 5.2) with `SIGNALED`, as `/mpls ldp remote-mapping` prints it in hex. It is type 0x80, the control word bit on Ethernet's PW type 0x0005, 8 bytes of interface parameters, and group ID 0. Then come PW ID 201 and the interface MTU sub-TLV with 1508.
 */
const SIGNALED_FEC = "8080050800000000000000C9010405E4";

/** The VPWS's VLAN and PW ID, and the VPLS's. */
const VPWS = { id: 201, pw: 201 };
const VPLS = { id: 202, pw: 202 };

/** One router of the lab: its name, CHR, management network, loopback, links, and its address in each VLAN it joins. */
type Router = {
    name: string;
    chr: string;
    management: string;
    loopback: string;
    links: Record<string, string>;
    vpws?: string;
    vpls?: string;
};

const P: Router = {
    name: "p-01",
    chr: pChr!,
    management: "10.0.0",
    loopback: "192.0.2.101",
    links: { "virtual-2": "192.0.2.17", "virtual-3": "192.0.2.21" },
    vpls: "203.0.113.65",
};
const FIRST_PE: Router = {
    name: "pe-01",
    chr: firstPeChr!,
    management: "10.0.1",
    loopback: "192.0.2.102",
    links: { "virtual-2": "192.0.2.18" },
    vpws: "203.0.113.1",
    vpls: "203.0.113.66",
};
const SECOND_PE: Router = {
    name: "pe-02",
    chr: secondPeChr!,
    management: "10.0.2",
    loopback: "192.0.2.103",
    links: { "virtual-2": "192.0.2.22" },
    vpws: "203.0.113.2",
    vpls: "203.0.113.67",
};
const ROUTERS = [P, FIRST_PE, SECOND_PE];

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

/** What a VPWS's pseudowire may set beside its peer and PW ID. */
type Signaled = { mtu?: number; control_word?: boolean };

/** A router of the lab, with the VPWS when `vpws` and the VPLS when `vpls`, each where it has an address for it. The VPWS's pseudowire has `signaled`. */
function writeRouter(router: Router, vpws: boolean, vpls: boolean, signaled: Signaled = {}): void {
    const [host, port] = router.chr.split(":");
    const ports = Object.entries(router.links)
        .map(([link, address]) => `"${link}": { description: "lab link", addresses: ["${address}/30"] },`)
        .join("\n            ");
    const ospf = Object.keys(router.links)
        .map((link) => `"${link}": { network: "point-to-point" },`)
        .join(" ");

    const vlans: string[] = [];
    const vlanInterfaces: string[] = [];
    const pseudowires: string[] = [];
    if (vpws && router.vpws) {
        const far = router === FIRST_PE ? SECOND_PE : FIRST_PE;
        vlans.push(`vpws: { id: ${VPWS.id} }`);
        vlanInterfaces.push(`"vlan-vpws": { vlan: "vpws", mtu: ${VLAN_MTU}, addresses: ["${router.vpws}/26"] }`);
        const settings = Object.entries(signaled)
            .map(([key, value]) => `, ${key}: ${String(value)}`)
            .join("");
        pseudowires.push(`"pw-vpws": { peer: "${far.loopback}", pw_id: ${VPWS.pw}, access_vlan: "vpws"${settings} }`);
    }
    if (vpls && router.vpls) {
        vlans.push(`vpls: { id: ${VPLS.id} }`);
        vlanInterfaces.push(`"vlan-vpls": { vlan: "vpls", mtu: ${VLAN_MTU}, addresses: ["${router.vpls}/26"] }`);
        for (const far of ROUTERS.filter((other) => other !== router))
            pseudowires.push(`"pw-vpls-${far.name}": { peer: "${far.loopback}", pw_id: ${VPLS.pw}, access_vlan: "vpls" }`);
    }

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
        vlan_interface: { ${vlanInterfaces.join(", ")} },
        pseudowire: { ${pseudowires.join(", ")} },
    },
    switching: { vlans: { ${vlans.join(", ")} } },
    routing: {
        router_id: "${router.loopback}",
        ospf: { areas: { "0.0.0.0": { interfaces: { loopback: { passive: true }, ${ospf} } } } },
        mpls: { ldp: { lsr_id: "${router.loopback}", interfaces: ${JSON.stringify(Object.keys(router.links))} } },
    },
});
`
    );
}

/** The three routers, the VPWS's pseudowire with `signaled`. */
function writeLab(vpws: boolean, vpls: boolean, signaled: Signaled = {}): void {
    for (const router of ROUTERS) writeRouter(router, vpws, vpls, signaled);
}

/** What `exec` printed for `commands` on `device`. */
function exec(device: string, ...commands: string[]): string {
    const { status, output } = circuit("exec", device, ...commands);
    expect(status).toBe(0);
    return output;
}

/** The names of a router's VPLS interfaces that run, flagged `R` in `/interface vpls print detail`: `0  R name="pw-vpws" ...`. */
function running(device: string): string[] {
    return exec(device, "/interface vpls print detail without-paging")
        .split("\n")
        .flatMap((line) => {
            const row = /^\s*\d+\s+([A-Z]*)\s*name="([^"]+)"/.exec(line);
            return row && row[1]!.includes("R") ? [row[2]!] : [];
        })
        .sort();
}

/** What `device` holds of the PWid FECs the far PE sent it, as `/mpls ldp remote-mapping print detail` prints them: `pw-fec=80...`. */
function farFec(device: string): string {
    return exec(device, "/mpls ldp remote-mapping print detail without-paging")
        .split("\n")
        .flatMap((line) => /\bpw-fec=([0-9A-F]+)/.exec(line)?.[1] ?? [])
        .join(",");
}

/** Whether `device` reaches `address`. */
function pings(device: string, address: string): boolean {
    return /received=[1-9]/.test(exec(device, `/ping ${address} count=3`));
}

/** What each router holds of its pseudowires, for the job's log. */
function logPseudowires(): void {
    for (const { name } of ROUTERS)
        exec(
            name,
            "/interface vpls export",
            "/interface vpls monitor [find] once",
            "/interface bridge port export",
            "/mpls ldp neighbor print detail"
        );
}

/** Applies to each router, and finds nothing to change after. */
function applyAll(): void {
    for (const { name } of ROUTERS) {
        // A diff first: the first export after a boot leaves out what the apply's read would then miss (TRAPS.md).
        circuit("diff", name);
        expect(circuit("apply", name, "--confirm").status).toBe(0);
        expect(circuit("diff", name).status).toBe(0);
    }
}

describe.skipIf(!pChr || !firstPeChr || !secondPeChr)("pseudowires between three CHRs", () => {
    beforeAll(() => {
        write("circuit.ts", `export const lab = circuit({ sites: { lab: { description: "Three CHRs, linked port to port." } } });\n`);
        writeLab(true, false);
    });

    afterAll(() => rmSync(folder, { recursive: true, force: true }));

    test(
        "a pseudowire between two PEs comes up, and the VLAN's two interfaces reach each other across it",
        () => {
            applyAll();
            const up = eventually(() => running("pe-01").join() === "pw-vpws" && running("pe-02").join() === "pw-vpws");
            logPseudowires();
            expect(up).toBe(true);
            expect(eventually(() => pings("pe-01", SECOND_PE.vpws!))).toBe(true);

            // LDP's state and the MAC each VPLS interface made up change nothing to plan.
            for (const { name } of ROUTERS) expect(circuit("diff", name).status).toBe(0);
        },
        TEST_MS
    );

    test(
        "a pseudowire with an MTU of its own and the control word at both ends tells each far end both, and carries frames",
        () => {
            writeLab(true, false, SIGNALED);
            for (const { name } of [FIRST_PE, SECOND_PE]) {
                expect(circuit("apply", name, "--confirm").status).toBe(0);
                expect(circuit("diff", name).status).toBe(0);
            }
            const signaled = eventually(() => [FIRST_PE, SECOND_PE].every(({ name }) => farFec(name).includes(SIGNALED_FEC)));
            const up = eventually(() => running("pe-01").includes("pw-vpws") && running("pe-02").includes("pw-vpws"));
            logPseudowires();
            expect(signaled).toBe(true);
            expect(up).toBe(true);
            expect(eventually(() => pings("pe-01", SECOND_PE.vpws!))).toBe(true);
            for (const { name } of ROUTERS) expect(circuit("diff", name).status).toBe(0);
        },
        TEST_MS
    );

    test(
        "three routers with a pseudowire to each other in one VLAN make a VPLS, in which each reaches the other two",
        () => {
            writeLab(true, true);
            applyAll();
            const meshed = ROUTERS.map(({ name }) => ({
                name,
                wanted: ROUTERS.filter((other) => other.name !== name).map((other) => `pw-vpls-${other.name}`),
            }));
            const up = eventually(() =>
                meshed.every(({ name, wanted }) => wanted.every((pseudowire) => running(name).includes(pseudowire)))
            );
            logPseudowires();
            expect(up).toBe(true);
            expect(eventually(() => pings("p-01", FIRST_PE.vpls!) && pings("p-01", SECOND_PE.vpls!))).toBe(true);
            expect(eventually(() => pings("pe-01", SECOND_PE.vpls!))).toBe(true);
            for (const { name } of ROUTERS) expect(circuit("diff", name).status).toBe(0);
        },
        TEST_MS
    );

    test(
        "without pseudowires in the config, each apply removes them and their bridge ports, and diff then finds nothing to change",
        () => {
            writeLab(false, false);
            for (const { name } of ROUTERS) {
                expect(circuit("apply", name, "--confirm").status).toBe(0);
                expect(circuit("diff", name).status).toBe(0);
                expect(exec(name, "/interface vpls export", "/interface bridge port export")).not.toMatch(/^add /m);
            }
        },
        TEST_MS
    );
});
