// Two RouterOS CHRs, which the devices workflow boots with the first's ether2 linked to the second's. edge-01 (AS64500) holds its link to cpe-01 (AS64501) in a VRF, and runs BGP with cpe-01 there. It then takes routes between that VRF and a second one, then runs OSPF with cpe-01 in the VRF, and last has static routes there. The tests run in order on the same two routers. Skipped without both CHRs.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/** Each CHR's SSH, and edge-01's REST API, as `host:port`. Both have the user `operator`, with the password in CIRCUIT_TEST_CHR_PASSWORD. */
const edgeChr = process.env.CIRCUIT_TEST_CHR;
const edgeRest = process.env.CHR_REST;
const cpeChr = process.env.CIRCUIT_TEST_CHR_B;
const password = process.env.CIRCUIT_TEST_CHR_PASSWORD ?? "";

const repo = join(import.meta.dir, "..", "..");
const folder = realpathSync(mkdtempSync(join(tmpdir(), "circuit-chr-vrf-")));

/** A test applies, and waits for BGP, several times. */
const TEST_MS = 300_000;

/** How long a session has to come up, or a route to arrive or leave. */
const WAIT_MS = 60_000;

const POLL_MS = 3000;

const VRF = "customers";
/** The second VRF, which holds edge-01's monitoring network. */
const SERVICES_VRF = "services";
const CPE_PREFIX = "203.0.113.0/24";
/** edge-01's monitoring network, a connected route in `SERVICES_VRF`. */
const MONITORING = "10.0.5.0/24";
/** The link between the two, a connected route in the VRF. */
const LINK = "192.0.2.0/30";
/** cpe-01's loopback, which it announces into OSPF. */
const CPE_LOOPBACK = "203.0.113.1/32";
/** A static route in edge-01's VRF, which its OSPF announces. */
const VRF_STATIC = "198.51.100.0/24";

/** OSPF in the VRF, over the link to cpe-01, with BFD, announcing the VRF's static routes. */
const OSPF_IN_VRF = `ospf: {
            vrf: "${VRF}",
            areas: { "0.0.0.0": { interfaces: { "virtual-2": { network: "point-to-point", bfd: true } } } },
            redistribute: ["static"],
        },
        static_routes: [{ prefix: "${VRF_STATIC}", blackhole: true, vrf: "${VRF}" }],`;

/** Networks of cpe-01 that edge-01 reaches by a static route in the VRF, and cpe-01's address in each. edge-01 reaches the first, on cpe-01's port, through its own port. It reaches the other two, on cpe-01's loopback, through cpe-01's address, alone and with the port. */
const BEHIND_PORT = "192.0.2.64/26";
const AT_PORT = "192.0.2.65";
const BEHIND_NEXT_HOP = "192.0.2.128/26";
const AT_NEXT_HOP = "192.0.2.129";
const BEHIND_NEXT_HOP_ON_PORT = "192.0.2.192/26";
const AT_NEXT_HOP_ON_PORT = "192.0.2.193";
/** A network through edge-01's VLAN interface in the VRF, on a trunk to the third CHR, which carries nothing here. A route through it is active once the interface runs. */
const BEHIND_VLAN = "192.0.2.32/27";

/** Each static route in the VRF, as the config writes it. */
const STATIC_IN_VRF = `static_routes: [
            { prefix: "${BEHIND_PORT}", interface: "virtual-2", vrf: "${VRF}" },
            { prefix: "${BEHIND_NEXT_HOP}", next_hop: "192.0.2.2", vrf: "${VRF}" },
            { prefix: "${BEHIND_NEXT_HOP_ON_PORT}", next_hop: "192.0.2.2", interface: "virtual-2", vrf: "${VRF}" },
            { prefix: "${BEHIND_VLAN}", interface: "lab", vrf: "${VRF}" },
        ],`;

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

/** A script run on a CHR through its REST API, as a person would type it, with what it printed. */
async function typed(rest: string, script: string): Promise<string> {
    const response = await fetch(`http://${rest}/rest/execute`, {
        method: "POST",
        headers: { authorization: `Basic ${btoa(`operator:${password}`)}`, "content-type": "application/json" },
        body: JSON.stringify({ script, "as-string": "" }),
    });
    const answer = await response.text();
    console.log(`${rest} typed ${script}: ${response.status} ${answer}`);
    expect(response.ok).toBe(true);
    return answer;
}

/** Whether `circuit bgp edge-01` shows its session with cpe-01 up. */
function sessionUp(): boolean {
    const { status, output } = circuit("bgp", "edge-01");
    expect(status).toBe(0);
    return output
        .split("\n")
        .map((line) => line.split("│").map((cell) => cell.trim()))
        .some((row) => row[1] === "cpe-01" && row[2] === "up");
}

/** How many active routes the device has to `prefix` in `table`. */
function activeRoutes(device: string, prefix: string, table = "main"): number {
    const { status, output } = circuit(
        "exec",
        device,
        `:put [:len [/ip route find where dst-address="${prefix}" and routing-table="${table}" and active]]`
    );
    expect(status).toBe(0);

    const count = output
        .split("\n")
        .map((line) => line.trim())
        .findLast((line) => /^\d+$/.test(line));
    if (count === undefined) throw new Error(`circuit exec ${device} printed no count`);
    return Number(count);
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

/** edge-01, with its link to cpe-01 and the session over it in the VRF, these imports between the two VRFs, these originated prefixes, and these other routing keys. With `vlan`, a VLAN interface in the VRF too, on a trunk to the third CHR. */
function writeEdge(imports: string, originated: readonly string[] = [MONITORING], routing = "", vlan = false): void {
    const [host, port] = edgeChr!.split(":");
    const trunk = vlan ? `\n            "virtual-3": { description: "The third CHR", trunk_vlans: ["lab"] },` : "";
    const vlanInterface = vlan ? `\n        vlan_interface: { lab: { vlan: "lab", addresses: ["192.0.2.5/30"], vrf: "${VRF}" } },` : "";
    const switching = vlan ? `\n    switching: { vlans: { lab: { id: 100 } } },` : "";
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
    management: { allow: ["10.0.0.0/24"], ssh: {}, http: {} },
    interfaces: {
        ethernet: {
            "virtual-1": { description: "Management", addresses: ["10.0.0.1/24"] },
            "virtual-2": { description: "cpe-01", addresses: ["192.0.2.1/30"], vrf: "${VRF}" },${trunk}
        },
        loopback: { monitoring: { addresses: ["10.0.5.1/24"], vrf: "${SERVICES_VRF}" } },${vlanInterface}
    },${switching}
    routing: {
        router_id: "192.0.2.1",
        vrfs: {
            "${VRF}": { description: "The customers we sell transit to" },
            "${SERVICES_VRF}": { description: "Our monitoring" },
        },
        vrf_imports: [${imports}],
        ${routing}
        bgp: {
            asn: 64500,
            originated_prefixes: ${JSON.stringify(originated)},
            neighbors: {
                "cpe-01": {
                    address: "192.0.2.2",
                    remote_as: 64501,
                    vrf: "${VRF}",
                    import_policy: "cpe-prefix",
                    export_policy: "monitoring",
                },
            },
        },
        policies: {
            "cpe-prefix": [{ if: { prefix: "${CPE_PREFIX}" }, then: "accept" }, { then: "reject" }],
            "to-services": [{ if: { prefix: "${CPE_PREFIX}" }, then: "accept" }, { if: { prefix: "${LINK}" }, then: "accept" }, { then: "reject" }],
            monitoring: [{ if: { prefix: "${MONITORING}" }, then: "accept" }, { then: "reject" }],
        },
    },
});
`
    );
}

/** cpe-01, with BGP and OSPF toward edge-01. With `behind`, the networks edge-01 reaches by its static routes in the VRF too. */
function writeCpe(behind = false): void {
    const [host, port] = cpeChr!.split(":");
    const onPort = behind ? `, "${AT_PORT}/26"` : "";
    const onLoopback = behind ? `, "${AT_NEXT_HOP}/26", "${AT_NEXT_HOP_ON_PORT}/26"` : "";
    write(
        "sites/lab/cpe-01.ts",
        `import { lab } from "../../circuit";

export default lab.device({
    name: "cpe-01",
    site: "lab",
    platform: "routeros",
    model: "CHR",
    connection: { host: "${host}", port: ${port}, user: "operator" },
    system: { users: { operator: { role: "admin", password: secret("OPERATOR_PASSWORD") } } },
    management: { allow: ["10.0.1.0/24"], ssh: {} },
    interfaces: {
        ethernet: {
            "virtual-1": { description: "Management", addresses: ["10.0.1.1/24"] },
            "virtual-2": { description: "edge-01", addresses: ["192.0.2.2/30"${onPort}] },
        },
        loopback: { loopback: { addresses: ["${CPE_LOOPBACK}"${onLoopback}] } },
    },
    routing: {
        router_id: "192.0.2.2",
        static_routes: [{ prefix: "${CPE_PREFIX}", blackhole: true }],
        ospf: {
            areas: {
                "0.0.0.0": { interfaces: { "virtual-2": { network: "point-to-point", bfd: true }, loopback: { passive: true } } },
            },
        },
        bgp: {
            asn: 64501,
            originated_prefixes: ["${CPE_PREFIX}"],
            neighbors: {
                "edge-01": { address: "192.0.2.1", remote_as: 64500, import_policy: "from-edge", export_policy: "to-edge" },
            },
        },
        policies: {
            "from-edge": [{ then: "accept" }],
            "to-edge": [{ if: { prefix: "${CPE_PREFIX}" }, then: "accept" }, { then: "reject" }],
        },
    },
});
`
    );
}

/** The customers' VRF takes the monitoring network, and the services' VRF takes the link and cpe-01's prefix. */
const BOTH_WAYS = `{ from: "${SERVICES_VRF}", to: "${VRF}", policy: "monitoring" }, { from: "${VRF}", to: "${SERVICES_VRF}", policy: "to-services" }`;

describe.skipIf(!edgeChr || !cpeChr)("a VRF on a CHR, with BGP in it, and routes taken between it and another VRF", () => {
    beforeAll(() => {
        write("circuit.ts", `export const lab = circuit({ sites: { lab: { description: "Two CHRs, linked port to port." } } });\n`);
        writeCpe();
    });

    afterAll(() => rmSync(folder, { recursive: true, force: true }));

    test(
        "the session runs in the VRF, and what it learns stays there",
        () => {
            writeEdge("");

            for (const device of ["edge-01", "cpe-01"]) {
                circuit("diff", device);
                expect(circuit("apply", device, "--confirm").status).toBe(0);
                expect(circuit("diff", device).status).toBe(0);
            }

            expect(eventually(sessionUp)).toBe(true);
            expect(eventually(() => activeRoutes("edge-01", CPE_PREFIX, VRF) === 1)).toBe(true);
            expect(activeRoutes("edge-01", CPE_PREFIX)).toBe(0);
            expect(activeRoutes("edge-01", CPE_PREFIX, SERVICES_VRF)).toBe(0);
            // The VRF holds no route to the monitoring network, so the session announces nothing.
            expect(activeRoutes("cpe-01", MONITORING)).toBe(0);
        },
        TEST_MS
    );

    test(
        "each VRF takes the other's connected routes its import's policy accepts, and the session announces what its VRF now holds",
        () => {
            writeEdge(BOTH_WAYS);
            expect(circuit("apply", "edge-01", "--confirm").status).toBe(0);
            expect(circuit("diff", "edge-01").status).toBe(0);

            const monitoringInVrf = eventually(() => activeRoutes("edge-01", MONITORING, VRF) === 1);
            const linkInServices = eventually(() => activeRoutes("edge-01", LINK, SERVICES_VRF) === 1);
            const announced = eventually(() => activeRoutes("cpe-01", MONITORING) === 1);
            // Every copy of the routes, for the job's log.
            circuit(
                "exec",
                "edge-01",
                `/routing route print detail where dst-address="${MONITORING}" or dst-address="${LINK}" or dst-address="${CPE_PREFIX}"`
            );

            expect({ monitoringInVrf, linkInServices, announced }).toEqual({
                monitoringInVrf: true,
                linkInServices: true,
                announced: true,
            });
        },
        TEST_MS
    );

    test(
        "a route BGP learned in a VRF goes to the other VRF too",
        () => {
            expect(eventually(() => activeRoutes("edge-01", CPE_PREFIX, SERVICES_VRF) === 1)).toBe(true);
        },
        TEST_MS
    );

    test(
        "without the imports, each VRF holds its own routes again",
        () => {
            // Without the route in the VRF, the session stops announcing it, so the config stops it too, or the check after the apply fails.
            writeEdge("", []);
            expect(circuit("apply", "edge-01", "--confirm").status).toBe(0);
            expect(circuit("diff", "edge-01").status).toBe(0);

            expect(eventually(() => activeRoutes("edge-01", MONITORING, VRF) === 0)).toBe(true);
            expect(eventually(() => activeRoutes("cpe-01", MONITORING) === 0)).toBe(true);
            expect(activeRoutes("edge-01", LINK, SERVICES_VRF)).toBe(0);
        },
        TEST_MS
    );

    test(
        "OSPF runs in the VRF with BFD: what it learns stays there, and it announces the VRF's static route",
        () => {
            writeEdge("", [], OSPF_IN_VRF);
            expect(circuit("apply", "edge-01", "--confirm").status).toBe(0);
            expect(circuit("diff", "edge-01").status).toBe(0);

            const learned = eventually(() => activeRoutes("edge-01", CPE_LOOPBACK, VRF) === 1);
            const announced = eventually(() => activeRoutes("cpe-01", VRF_STATIC) === 1);
            const bfd = eventually(() => circuit("exec", "edge-01", "/routing bfd session print detail").output.includes("state=up"));
            // The neighbor and the BFD session, for the job's log.
            circuit("exec", "edge-01", "/routing ospf neighbor print detail");

            expect({ learned, announced, bfd, inMain: activeRoutes("edge-01", CPE_LOOPBACK) }).toEqual({
                learned: true,
                announced: true,
                bfd: true,
                inMain: 0,
            });
        },
        TEST_MS
    );

    test(
        "without OSPF, the VRF loses what it learned",
        () => {
            writeEdge("", []);
            expect(circuit("apply", "edge-01", "--confirm").status).toBe(0);
            expect(circuit("diff", "edge-01").status).toBe(0);

            expect(eventually(() => activeRoutes("edge-01", CPE_LOOPBACK, VRF) === 0)).toBe(true);
        },
        TEST_MS
    );

    test(
        "a static route in the VRF names the VRF in its gateway: through the port, a VLAN interface, or to a next hop, each is active, and one without the VRF is replaced",
        async () => {
            writeCpe(true);
            expect(circuit("apply", "cpe-01", "--confirm").status).toBe(0);
            expect(circuit("diff", "cpe-01").status).toBe(0);

            // Two routes as Circuit wrote them before, which RouterOS keeps inactive: it looks a gateway up in main (TRAPS.md).
            await typed(edgeRest!, `/ip route add dst-address=${BEHIND_PORT} gateway=ether2 routing-table=${VRF}`);
            await typed(edgeRest!, `/ip route add dst-address=${BEHIND_NEXT_HOP} gateway=192.0.2.2 routing-table=${VRF}`);
            expect(activeRoutes("edge-01", BEHIND_PORT, VRF)).toBe(0);
            expect(activeRoutes("edge-01", BEHIND_NEXT_HOP, VRF)).toBe(0);

            writeEdge("", [], STATIC_IN_VRF, true);
            const planned = circuit("diff", "edge-01").output;
            expect(planned).toContain(`dst-address=${BEHIND_PORT} gateway=ether2@${VRF}`);
            expect(planned).toContain(`dst-address=${BEHIND_NEXT_HOP} gateway=192.0.2.2@${VRF}`);
            expect(circuit("apply", "edge-01", "--confirm").status).toBe(0);
            expect(circuit("diff", "edge-01").status).toBe(0);

            const active = Object.fromEntries(
                [BEHIND_PORT, BEHIND_NEXT_HOP, BEHIND_NEXT_HOP_ON_PORT, BEHIND_VLAN].map((prefix) => [
                    prefix,
                    eventually(() => activeRoutes("edge-01", prefix, VRF) === 1),
                ])
            );
            const answered = Object.fromEntries(
                [AT_PORT, AT_NEXT_HOP, AT_NEXT_HOP_ON_PORT].map((address) => [
                    address,
                    circuit("exec", "edge-01", `/ping ${address} vrf=${VRF} count=3`).output.includes("received=3"),
                ])
            );
            // Each route and the gateway it resolved, for the job's log.
            circuit("exec", "edge-01", `/ip route print detail where routing-table=${VRF} and static`);

            expect({ active, answered }).toEqual({
                active: { [BEHIND_PORT]: true, [BEHIND_NEXT_HOP]: true, [BEHIND_NEXT_HOP_ON_PORT]: true, [BEHIND_VLAN]: true },
                answered: { [AT_PORT]: true, [AT_NEXT_HOP]: true, [AT_NEXT_HOP_ON_PORT]: true },
            });
            expect(circuit("diff", "edge-01").status).toBe(0);
        },
        TEST_MS
    );
});
