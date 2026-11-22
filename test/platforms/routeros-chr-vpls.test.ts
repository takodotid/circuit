// VPLSs whose PEs BGP finds, on the three CHRs of the devices workflow, with OSPF and LDP as in routeros-chr-mpls.test.ts. Each router has two VLANs, each in a VPLS: BGP sets up one's pseudowires (RFC 4761), and LDP the other's (RFC 6074). Then one VPLS changes, then the first router reflects the routes of the others, and last the VPLSs go. Skipped without the three CHRs.

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
const folder = realpathSync(mkdtempSync(join(tmpdir(), "circuit-chr-vpls-")));

/** A test applies to three routers, and waits for OSPF, LDP, BGP, and the pseudowires. */
const TEST_MS = 300_000;

/** How long the pseudowires have to come up, or go. */
const WAIT_MS = 120_000;

const POLL_MS = 3000;

/** The MTU of a VLAN interface on a bridge where a pseudowire runs, which RouterOS lowers it to (TRAPS.md). */
const VLAN_MTU = 1496;

/** The VLAN whose pseudowires BGP sets up, and the one whose pseudowires LDP sets up, each with its ID, route target, and route distinguisher. */
const SCHOOL = { id: 301, target: "64500:301" };
const LIBRARY = { id: 302, target: "64500:302" };

/** Another route distinguisher, an added import target, and another site ID, for the change. */
const CHANGED: Vpls = { route_distinguisher: "192.0.2.102:301", import: [SCHOOL.target, "64500:399"], site_id: 12 };

/** How many VPLS interfaces each router runs once meshed: one to each other router, in each of the two VLANs. */
const MESHED = 4;

/** One router of the lab: its name, CHR, management network, loopback, links, site ID, and its address in each VLAN. */
type Router = {
    name: string;
    chr: string;
    management: string;
    loopback: string;
    links: Record<string, string>;
    site: number;
    school: string;
    library: string;
};

const P: Router = {
    name: "p-01",
    chr: pChr!,
    management: "10.0.0",
    loopback: "192.0.2.101",
    links: { "virtual-2": "192.0.2.17", "virtual-3": "192.0.2.21" },
    site: 1,
    school: "203.0.113.65",
    library: "203.0.113.129",
};
const FIRST_PE: Router = {
    name: "pe-01",
    chr: firstPeChr!,
    management: "10.0.1",
    loopback: "192.0.2.102",
    links: { "virtual-2": "192.0.2.18" },
    site: 2,
    school: "203.0.113.66",
    library: "203.0.113.130",
};
const SECOND_PE: Router = {
    name: "pe-02",
    chr: secondPeChr!,
    management: "10.0.2",
    loopback: "192.0.2.103",
    links: { "virtual-2": "192.0.2.22" },
    site: 3,
    school: "203.0.113.67",
    library: "203.0.113.131",
};
const ROUTERS = [P, FIRST_PE, SECOND_PE];

/** What the school's VPLS on a router has in place of the lab's own, for the change. */
type Vpls = { route_distinguisher?: string; import?: string[]; site_id?: number };

/** How the lab's routers are set up: with the VPLSs, with `changed` on pe-01's school, and with p-01 reflecting the PEs' routes. */
type Lab = { vpls: boolean; changed?: Vpls; reflected?: boolean };

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

/** The BGP neighbors of a router: each other router, or with `reflected` p-01 alone for a PE, and p-01 with both PEs as its clients. */
function neighbors(router: Router, reflected: boolean): string {
    const others = ROUTERS.filter((other) => other !== router && (!reflected || router === P || other === P));
    const client = reflected && router === P ? ", route_reflector_client: true" : "";
    return others
        .map(
            (other) =>
                `"${other.name}": { address: "${other.loopback}", remote_as: 64500, local_address: "${router.loopback}", address_families: ["l2vpn-vpls"]${client} },`
        )
        .join("\n                ");
}

/** A router of the lab, set up as `lab` says. */
function writeRouter(router: Router, { vpls, changed, reflected }: Lab): void {
    const [host, port] = router.chr.split(":");
    const ports = Object.entries(router.links)
        .map(([link, address]) => `"${link}": { description: "lab link", addresses: ["${address}/30"] },`)
        .join("\n            ");
    const ospf = Object.keys(router.links)
        .map((link) => `"${link}": { network: "point-to-point" },`)
        .join(" ");
    const own = router === FIRST_PE ? (changed ?? {}) : {};
    const school = {
        route_distinguisher: own.route_distinguisher ?? SCHOOL.target,
        route_targets: { import: own.import ?? [SCHOOL.target], export: [SCHOOL.target] },
        site_id: own.site_id ?? router.site,
    };
    const library = {
        route_distinguisher: LIBRARY.target,
        route_targets: { import: [LIBRARY.target], export: [LIBRARY.target] },
        vpls_id: LIBRARY.target,
    };
    const inVpls = (settings: object) => (vpls ? `, vpls: ${JSON.stringify(settings)}` : "");

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
            "vlan-school": { vlan: "school", mtu: ${VLAN_MTU}, addresses: ["${router.school}/26"] },
            "vlan-library": { vlan: "library", mtu: ${VLAN_MTU}, addresses: ["${router.library}/26"] },
        },
    },
    switching: {
        vlans: {
            school: { id: ${SCHOOL.id}${inVpls(school)} },
            library: { id: ${LIBRARY.id}${inVpls(library)} },
        },
    },
    routing: {
        router_id: "${router.loopback}",
        ospf: { areas: { "0.0.0.0": { interfaces: { loopback: { passive: true }, ${ospf} } } } },
        mpls: { ldp: { lsr_id: "${router.loopback}", interfaces: ${JSON.stringify(Object.keys(router.links))} } },
        bgp: {
            asn: 64500,
            neighbors: {
                ${neighbors(router, Boolean(reflected))}
            },
        },
    },
});
`
    );
}

/** The three routers, set up as `lab` says. */
function writeLab(lab: Lab): void {
    for (const router of ROUTERS) writeRouter(router, lab);
}

/** What `exec` printed for `commands` on `device`. */
function exec(device: string, ...commands: string[]): string {
    const { status, output } = circuit("exec", device, ...commands);
    expect(status).toBe(0);
    return output;
}

/** The VPLS interfaces a router runs, flagged `R` in `/interface vpls print detail`, each by its peer and VLAN: `192.0.2.102 301`. BGP's and LDP's are dynamic, `RD`. */
function running(device: string): string[] {
    const printed = exec(device, "/interface vpls print detail without-paging");
    return printed
        .split(/\n\s*\n/)
        .filter((entry) => /^\s*\d+\s+[A-Z]*R/m.test(entry))
        .map((entry) => `${/\bpeer=(\S+)/.exec(entry)?.[1]} ${/\bbridge-pvid=(\d+)/.exec(entry)?.[1]}`)
        .sort();
}

/** Whether each router runs a pseudowire to each other router in each VLAN, peered with that router's loopback. */
function meshed(): boolean {
    return ROUTERS.every(({ name, loopback }) => {
        const wanted = ROUTERS.filter((other) => other.loopback !== loopback)
            .flatMap((other) => [`${other.loopback} ${SCHOOL.id}`, `${other.loopback} ${LIBRARY.id}`])
            .sort();
        return running(name).join() === wanted.join();
    });
}

/** Whether `device` reaches `address`. */
function pings(device: string, address: string): boolean {
    return /received=[1-9]/.test(exec(device, `/ping ${address} count=3`));
}

/** Whether every router reaches the other two in both VLANs. */
function reachable(): boolean {
    const pairs: [Router, Router][] = [
        [P, FIRST_PE],
        [P, SECOND_PE],
        [FIRST_PE, SECOND_PE],
    ];
    return eventually(() => pairs.every(([from, to]) => pings(from.name, to.school) && pings(from.name, to.library)));
}

/** What each router holds of its VPLSs, for the job's log. */
function logVpls(): void {
    for (const { name } of ROUTERS)
        exec(
            name,
            "/routing bgp vpls print detail without-paging",
            "/interface vpls print detail without-paging",
            "/routing bgp session print without-paging"
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

describe.skipIf(!pChr || !firstPeChr || !secondPeChr)("VPLSs whose PEs BGP finds, among three CHRs", () => {
    beforeAll(() => {
        write("circuit.ts", `export const lab = circuit({ sites: { lab: { description: "Three CHRs, linked port to port." } } });\n`);
        writeLab({ vpls: true });
    });

    afterAll(() => rmSync(folder, { recursive: true, force: true }));

    test(
        "three routers find each other by BGP in two VLANs, set up a pseudowire to each other in each, by BGP and by LDP, and reach each other",
        () => {
            applyAll();
            const up = eventually(meshed);
            logVpls();
            expect(up).toBe(true);
            expect(running(P.name)).toHaveLength(MESHED);
            expect(reachable()).toBe(true);

            // The pseudowires BGP and LDP set up, and their bridge ports, are the device's own: they change nothing to plan.
            for (const { name } of ROUTERS) expect(circuit("diff", name).status).toBe(0);
        },
        TEST_MS
    );

    test(
        "another site ID, route distinguisher, and import target on one router are set in place, and its pseudowires come back",
        () => {
            writeLab({ vpls: true, changed: CHANGED });
            const plan = circuit("diff", FIRST_PE.name).output;
            expect(plan).toContain("site-id=12");
            expect(plan).not.toContain("~ replace");
            expect(circuit("apply", FIRST_PE.name, "--confirm").status).toBe(0);
            expect(circuit("diff", FIRST_PE.name).status).toBe(0);

            const up = eventually(meshed);
            logVpls();
            expect(up).toBe(true);
            expect(reachable()).toBe(true);
            for (const { name } of ROUTERS) expect(circuit("diff", name).status).toBe(0);
        },
        TEST_MS
    );

    test(
        "with p-01 reflecting the VPLS routes of the two PEs, which hold no session with each other, each PE still sets up a pseudowire to the other",
        () => {
            writeLab({ vpls: true, changed: CHANGED, reflected: true });
            applyAll();
            const up = eventually(meshed);
            logVpls();
            expect(up).toBe(true);
            expect(eventually(() => pings(FIRST_PE.name, SECOND_PE.school) && pings(FIRST_PE.name, SECOND_PE.library))).toBe(true);
            for (const { name } of ROUTERS) expect(circuit("diff", name).status).toBe(0);
        },
        TEST_MS
    );

    test(
        "without vpls in the config, each apply removes the BGP VPLS entries and the pseudowires they set up, and diff then finds nothing to change",
        () => {
            writeLab({ vpls: false, reflected: true });
            for (const { name } of ROUTERS) {
                expect(circuit("apply", name, "--confirm").status).toBe(0);
                expect(circuit("diff", name).status).toBe(0);
                expect(exec(name, "/routing bgp vpls export")).not.toMatch(/^add /m);
            }
            expect(eventually(() => ROUTERS.every(({ name }) => running(name).length === 0))).toBe(true);
        },
        TEST_MS
    );
});
