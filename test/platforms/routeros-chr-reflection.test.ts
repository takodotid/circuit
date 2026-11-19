// Three RouterOS CHRs, which the devices workflow boots with the first's ether2 linked to the second's ether2, and its ether3 to the third's. In AS64500, rr-01 reflects routes between its two clients, edge-01 and edge-02, which have no session with each other (RFC 4456). The tests run in order on the same three routers. Skipped without all three CHRs.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/** Each CHR's SSH, as `host:port`. Each has the user `operator`, with the password in CIRCUIT_TEST_CHR_PASSWORD. */
const reflectorChr = process.env.CIRCUIT_TEST_CHR;
const firstClientChr = process.env.CIRCUIT_TEST_CHR_B;
const secondClientChr = process.env.CIRCUIT_TEST_CHR_C;
const password = process.env.CIRCUIT_TEST_CHR_PASSWORD ?? "";

const repo = join(import.meta.dir, "..", "..");
const folder = realpathSync(mkdtempSync(join(tmpdir(), "circuit-chr-reflection-")));

/** A test applies to three routers, and waits for BGP. */
const TEST_MS = 300_000;

/** How long a session has to come up, or a route to arrive or leave. */
const WAIT_MS = 60_000;

const POLL_MS = 3000;

/** rr-01's cluster ID, unlike any router ID, so a reflected route shows it came from the config. */
const CLUSTER_ID = "192.0.2.100";

/**
 * Each client's link to rr-01, rr-01's address on it, the client's, which is also its router ID and so the ORIGINATOR_ID of its routes, and the prefix it originates. The links are not the pair test's, so its BGP connections are removed rather than changed, which the plan cannot do yet (#266).
 */
const EDGE_01 = { link: "192.0.2.8/30", reflector: "192.0.2.9", address: "192.0.2.10", prefix: "198.51.100.0/24" };
const EDGE_02 = { link: "192.0.2.12/30", reflector: "192.0.2.13", address: "192.0.2.14", prefix: "203.0.113.0/24" };

/** Marks the line of `reflected`'s output that holds the attributes. */
const ATTRIBUTES = "ATTRIBUTES";

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

/** Whether rr-01's session with `client` is up, as `circuit bgp` shows it. */
function up(client: string): boolean {
    const { status, output } = circuit("bgp", "rr-01");
    expect(status).toBe(0);

    const cells = output
        .split("\n")
        .map((line) => line.split("│").map((cell) => cell.trim()))
        .find((row) => row[1] === client);
    return cells?.[2] === "up";
}

/** How many active routes the device has to `prefix`. A client has a route to the other client's prefix only through the reflector. */
function activeRoutes(device: string, prefix: string): number {
    const { status, output } = circuit("exec", device, `:put [:len [/ip route find where dst-address="${prefix}" and active]]`);
    expect(status).toBe(0);

    const count = output
        .split("\n")
        .map((line) => line.trim())
        .findLast((line) => /^\d+$/.test(line));
    if (count === undefined) throw new Error(`circuit exec ${device} printed no count`);
    return Number(count);
}

/** The ORIGINATOR_ID and CLUSTER_LIST of the device's route to `prefix`. The route is printed whole first, for the job's log. */
function reflected(device: string, prefix: string): { originatorId: string; clusterList: string } {
    const { status, output } = circuit(
        "exec",
        device,
        `/routing route print detail where dst-address="${prefix}"`,
        `:foreach r in=[/routing route find where dst-address="${prefix}"] do={ :put ("${ATTRIBUTES}|" . [/routing route get $r bgp.originator-id] . "|" . [/routing route get $r bgp.cluster-list]) }`
    );
    expect(status).toBe(0);

    const line = output.split("\n").find((candidate) => candidate.startsWith(`${ATTRIBUTES}|`));
    if (!line) throw new Error(`${device} has no route to ${prefix}`);
    const [, originatorId = "", clusterList = ""] = line.trim().split("|");
    return { originatorId, clusterList };
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

/** The policy that accepts each of `prefixes`, and rejects the rest. */
function accepting(...prefixes: string[]): string {
    return `[${[...prefixes.map((prefix) => `{ if: { prefix: "${prefix}" }, then: "accept" }`), `{ then: "reject" }`].join(", ")}]`;
}

/** rr-01, with its two clients marked as such, or as plain iBGP neighbors. */
function writeReflector(clients: boolean): void {
    const [host, port] = reflectorChr!.split(":");
    const client = clients ? "route_reflector_client: true," : "";
    write(
        "sites/lab/rr-01.ts",
        `import { lab } from "../../circuit";

export default lab.device({
    name: "rr-01",
    site: "lab",
    platform: "routeros",
    model: "CHR",
    connection: { host: "${host}", port: ${port}, user: "operator" },
    system: { users: { operator: { role: "admin", password: secret("OPERATOR_PASSWORD") } } },
    management: { allow: ["10.0.0.0/24"], ssh: {} },
    interfaces: {
        ethernet: {
            "virtual-1": { description: "Management", addresses: ["10.0.0.1/24"] },
            "virtual-2": { description: "edge-01", addresses: ["${EDGE_01.reflector}/30"] },
            "virtual-3": { description: "edge-02", addresses: ["${EDGE_02.reflector}/30"] },
        },
    },
    routing: {
        router_id: "${EDGE_01.reflector}",
        bgp: {
            asn: 64500,
            cluster_id: "${CLUSTER_ID}",
            neighbors: {
                "edge-01": { address: "${EDGE_01.address}", remote_as: 64500, ${client} import_policy: "clients", export_policy: "clients" },
                "edge-02": { address: "${EDGE_02.address}", remote_as: 64500, ${client} import_policy: "clients", export_policy: "clients" },
            },
        },
        policies: { clients: ${accepting(EDGE_01.prefix, EDGE_02.prefix)} },
    },
});
`
    );
}

/** A client, with a route to the other client's link, which the other's routes name as their next hop. */
type Client = { name: string; chr: string; management: string; own: typeof EDGE_01; other: typeof EDGE_01 };

function writeClient({ name, chr, management, own, other }: Client): void {
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
            "virtual-2": { description: "rr-01", addresses: ["${own.address}/30"] },
        },
    },
    routing: {
        router_id: "${own.address}",
        static_routes: [
            { prefix: "${own.prefix}", blackhole: true },
            { prefix: "${other.link}", next_hop: "${own.reflector}" },
        ],
        bgp: {
            asn: 64500,
            originated_prefixes: ["${own.prefix}"],
            neighbors: {
                "rr-01": { address: "${own.reflector}", remote_as: 64500, import_policy: "from-rr", export_policy: "to-rr" },
            },
        },
        policies: {
            "from-rr": ${accepting(other.prefix)},
            "to-rr": ${accepting(own.prefix)},
        },
    },
});
`
    );
}

describe.skipIf(!reflectorChr || !firstClientChr || !secondClientChr)("a CHR reflecting routes between two others", () => {
    beforeAll(() => {
        write("circuit.ts", `export const lab = circuit({ sites: { lab: { description: "A route reflector and two clients." } } });\n`);
        writeReflector(true);
        writeClient({ name: "edge-01", chr: firstClientChr!, management: "10.0.1", own: EDGE_01, other: EDGE_02 });
        writeClient({ name: "edge-02", chr: secondClientChr!, management: "10.0.2", own: EDGE_02, other: EDGE_01 });
    });

    afterAll(() => rmSync(folder, { recursive: true, force: true }));

    test(
        "each client gets the other's prefix through the reflector, with the client's router ID as ORIGINATOR_ID and the cluster ID in CLUSTER_LIST",
        () => {
            // A diff first: the first export after a boot leaves out what the apply's read would then miss (TRAPS.md).
            for (const device of ["rr-01", "edge-01", "edge-02"]) {
                expect(circuit("diff", device).status).toBe(1);
                expect(circuit("apply", device, "--confirm").status).toBe(0);
                expect(circuit("diff", device).status).toBe(0);
            }

            expect(eventually(() => up("edge-01") && up("edge-02"))).toBe(true);
            expect(eventually(() => activeRoutes("edge-02", EDGE_01.prefix) === 1)).toBe(true);
            expect(eventually(() => activeRoutes("edge-01", EDGE_02.prefix) === 1)).toBe(true);

            expect(reflected("edge-02", EDGE_01.prefix)).toEqual({ originatorId: EDGE_01.address, clusterList: CLUSTER_ID });
            expect(reflected("edge-01", EDGE_02.prefix)).toEqual({ originatorId: EDGE_02.address, clusterList: CLUSTER_ID });
        },
        TEST_MS
    );

    test(
        "with neither client marked, rr-01 reflects nothing",
        () => {
            writeReflector(false);
            expect(circuit("apply", "rr-01", "--confirm").status).toBe(0);
            expect(circuit("diff", "rr-01").status).toBe(0);

            expect(eventually(() => activeRoutes("edge-02", EDGE_01.prefix) === 0)).toBe(true);
            expect(eventually(() => activeRoutes("edge-01", EDGE_02.prefix) === 0)).toBe(true);
            expect(up("edge-01") && up("edge-02")).toBe(true);
        },
        TEST_MS
    );
});
