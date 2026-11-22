// Three RouterOS CHRs, which the devices workflow boots, the first linked to the other two (#376). edge-01 holds each link in a VRF. Then its port to cpe-01 joins the bridge as that VRF goes, and its port to host-01 joins a LAG as the other VRF lets it go. Then both ports route in main, then go back into the bridge and the LAG, and into their VRFs from there. Skipped without the three CHRs.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/** Each CHR's SSH, as `host:port`. Each has the user `operator`, with the password in CIRCUIT_TEST_CHR_PASSWORD. */
const edgeChr = process.env.CIRCUIT_TEST_CHR;
const cpeChr = process.env.CIRCUIT_TEST_CHR_B;
const hostChr = process.env.CIRCUIT_TEST_CHR_C;
const password = process.env.CIRCUIT_TEST_CHR_PASSWORD ?? "";

const repo = join(import.meta.dir, "..", "..");
const folder = realpathSync(mkdtempSync(join(tmpdir(), "circuit-chr-vrf-removal-")));

/** The test applies to each far router once, then to edge-01 six times, and waits for pings after each. */
const TEST_MS = 500_000;

/** How long a link has to carry pings after an apply. */
const WAIT_MS = 30_000;

const POLL_MS = 3000;

/** edge-01's ends of its links, and the far ends. */
const EDGE = { cpe: "192.0.2.1/30", host: "192.0.2.5/30" };
const CPE = "192.0.2.2";
const HOST = "192.0.2.6";

/** The VRFs edge-01 holds its links in. The services VRF also holds a loopback, so it keeps a member when its port leaves. */
const CUSTOMERS = "customers";
const SERVICES = "services";

/** How edge-01 holds its links: the ports, its other interfaces, and its VRFs. The LAG holds the spare fourth port when the port to host-01 is not in it. */
type Links = { ports: string; interfaces: string; vrfs: string };

const SPARE_LAG = `lag: { "lag-1": { description: "host-01", mode: "static" } },`;
const MONITORING = `loopback: { monitoring: { addresses: ["10.0.5.1/24"], vrf: "${SERVICES}" } },`;

/** Each link in a VRF of its own. */
const IN_VRFS: Links = {
    ports: `"virtual-2": { description: "cpe-01", addresses: ["${EDGE.cpe}"], vrf: "${CUSTOMERS}" },
            "virtual-3": { description: "host-01", addresses: ["${EDGE.host}"], vrf: "${SERVICES}" },
            "virtual-4": { description: "Spare", in_lag: "lag-1" },`,
    interfaces: `${SPARE_LAG} ${MONITORING}`,
    vrfs: `vrfs: { "${CUSTOMERS}": { description: "cpe-01's link" }, "${SERVICES}": { description: "Our services" } },`,
};

/** The port to cpe-01 an access port of the bridge, routed by a VLAN interface in main, as the customers VRF goes. The port to host-01 the LAG's member, routed by the LAG in main, as the services VRF lets it go. */
const JOINED: Links = {
    ports: `"virtual-2": { description: "cpe-01", access_vlan: "transit" },
            "virtual-3": { description: "host-01", in_lag: "lag-1" },`,
    interfaces: `lag: { "lag-1": { description: "host-01", mode: "static", addresses: ["${EDGE.host}"] } },
        vlan_interface: { transit: { vlan: "transit", addresses: ["${EDGE.cpe}"] } },
        ${MONITORING}`,
    vrfs: `vrfs: { "${SERVICES}": { description: "Our services" } },`,
};

/** Each port routed in main, with no VRF. */
const IN_MAIN: Links = {
    ports: `"virtual-2": { description: "cpe-01", addresses: ["${EDGE.cpe}"] },
            "virtual-3": { description: "host-01", addresses: ["${EDGE.host}"] },
            "virtual-4": { description: "Spare", in_lag: "lag-1" },`,
    interfaces: SPARE_LAG,
    vrfs: "",
};

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

/** A far router, whose port to edge-01 holds `address`. */
function writeFar(name: string, chr: string, management: string, address: string): void {
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
    interfaces: {
        ethernet: {
            "virtual-1": { description: "Management", addresses: ["${management}.1/24"] },
            "virtual-2": { description: "edge-01", addresses: ["${address}/30"] },
        },
    },
});
`
    );
}

/** edge-01, holding its links as `links` writes them. */
function writeEdge(links: Links): void {
    const [host, port] = edgeChr!.split(":");
    const switching = links === JOINED ? `switching: { vlans: { transit: { id: 300 } } },` : "";
    const routing = links.vrfs ? `routing: { ${links.vrfs} },` : "";
    write(
        "sites/lab/edge-01.ts",
        `import { lab } from "../../circuit";

export default lab.device({
    name: "edge-01",
    site: "lab",
    platform: "routeros",
    model: "CHR",
    connection: { host: "${host}", port: ${port}, user: "operator" },
    system: { users: { operator: { role: "admin", password: secret("OPERATOR_PASSWORD") } } },
    management: { allow: ["10.0.0.0/24"], ssh: {} },
    interfaces: {
        ethernet: {
            "virtual-1": { description: "Management", addresses: ["10.0.0.1/24"] },
            ${links.ports}
        },
        ${links.interfaces}
    },
    ${switching}
    ${routing}
});
`
    );
}

/** Whether edge-01 reaches `address`, in `vrf` or in main. */
function reaches(address: string, vrf?: string): boolean {
    const { status, output } = circuit("exec", "edge-01", `/ping ${address} count=3${vrf ? ` vrf=${vrf}` : ""}`);
    expect(status).toBe(0);
    return /received=[1-9]/.test(output);
}

/** Applies edge-01 as written, checks that it then matches, and that each link carries pings: in the VRF `vrfs` gives, or in main. */
function converges(vrfs: { cpe?: string; host?: string } = {}): void {
    expect(circuit("apply", "edge-01", "--confirm").status).toBe(0);
    expect(circuit("diff", "edge-01").status).toBe(0);
    // Each port's VRF, for the job's log: `print` shows the one it routes in, which the export leaves out.
    circuit(
        "exec",
        "edge-01",
        "/ip vrf print detail without-paging",
        "/ip address print detail without-paging",
        '/interface print detail without-paging where name="ether2" or name="ether3"'
    );
    expect({ cpe: eventually(() => reaches(CPE, vrfs.cpe)), host: eventually(() => reaches(HOST, vrfs.host)) }).toEqual({
        cpe: true,
        host: true,
    });
}

describe.skipIf(!edgeChr || !cpeChr || !hostChr)("a CHR's ports leaving VRFs for a bridge and a LAG", () => {
    beforeAll(() => {
        write("circuit.ts", `export const lab = circuit({ sites: { lab: { description: "Three CHRs, linked port to port." } } });\n`);
        writeFar("cpe-01", cpeChr!, "10.0.1", CPE);
        writeFar("host-01", hostChr!, "10.0.2", HOST);
        writeEdge(IN_VRFS);
    });

    afterAll(() => rmSync(folder, { recursive: true, force: true }));

    test(
        "each port joins the bridge or the LAG once out of its VRF, routes in main once out of them, and goes back the same way",
        () => {
            for (const device of ["cpe-01", "host-01"]) {
                // A diff first: the first export after a boot leaves out what the apply's read would then miss (TRAPS.md).
                circuit("diff", device);
                expect(circuit("apply", device, "--confirm").status).toBe(0);
                expect(circuit("diff", device).status).toBe(0);
            }
            circuit("diff", "edge-01");
            converges({ cpe: CUSTOMERS, host: SERVICES });

            writeEdge(JOINED);
            converges();

            // Out of the bridge and the LAG, each port routes in main, not in the VRF it was in.
            writeEdge(IN_MAIN);
            converges();

            // Back into the bridge and the LAG, then from there into the VRFs.
            writeEdge(JOINED);
            converges();
            writeEdge(IN_VRFS);
            converges({ cpe: CUSTOMERS, host: SERVICES });

            // Each VRF goes with its port in it.
            writeEdge(IN_MAIN);
            converges();
        },
        TEST_MS
    );
});
