// Three RouterOS CHRs, which the devices workflow boots, the first linked to the other two. edge-01 routes between cpe-01 and host-01, and limits the traffic through its port to cpe-01, each way, then through its VLAN interface to host-01. A CHR without a license sends at most 1 Mbit/s from each interface, so the limits are well below it. Skipped without the three CHRs.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Ssh } from "../../src/transport/ssh";

/** Each CHR's SSH, as `host:port`. Each has the user `operator`, with the password in CIRCUIT_TEST_CHR_PASSWORD. */
const edgeChr = process.env.CIRCUIT_TEST_CHR;
const cpeChr = process.env.CIRCUIT_TEST_CHR_B;
const hostChr = process.env.CIRCUIT_TEST_CHR_C;
const password = process.env.CIRCUIT_TEST_CHR_PASSWORD ?? "";

const repo = join(import.meta.dir, "..", "..");
const folder = realpathSync(mkdtempSync(join(tmpdir(), "circuit-chr-rate-limit-")));

/** A test applies to three routers, and measures for a while. */
const TEST_MS = 300_000;

/** cpe-01's and host-01's ends of their links to edge-01. */
const CPE = "192.0.2.2";
const HOST = "198.51.100.2";

/** What edge-01 lets in from a neighbor, and out to cpe-01, in kbit/s. */
const INPUT_KBPS = 200;
const OUTPUT_KBPS = 400;
const KBIT = 1000;

/** How far above its limit a measured rate may be: a bandwidth test counts its own headers. */
const MARGIN = 1.2;

/** How long each bandwidth test sends. Its last 10 seconds are measured, after the queue has filled. */
const MEASURE = "15s";

const UNITS: Record<string, number> = { "": 1, k: 1e3, M: 1e6, G: 1e9 };

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

/** Runs a command on a CHR over SSH, for what `circuit exec` refuses: a bandwidth test, or turning on its server. */
async function onChr(chr: string, command: string): Promise<string> {
    const [host, port] = chr.split(":");
    const client = await Ssh.connect({ host: host!, port: Number(port), user: "operator+ct", password: () => password });
    try {
        const output = await Ssh.exec(client, command);
        console.log(`$ ${chr} ${command}\n${output}`);
        return output;
    } finally {
        client.end();
    }
}

/** The rate a CHR received at from `address` over the last 10 seconds of a bandwidth test, in bits per second. */
async function received(chr: string, address: string): Promise<number> {
    const output = await onChr(chr, `/tool bandwidth-test address=${address} direction=receive protocol=udp duration=${MEASURE}`);
    const last = [...output.matchAll(/rx-10-second-average: ([\d.]+)([kMG]?)bps/g)].at(-1);
    if (!last) throw new Error(`the bandwidth test to ${address} printed no average`);
    return Number(last[1]) * UNITS[last[2]!]!;
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

/** edge-01, with these settings of its ports to cpe-01 and host-01, and these VLAN interfaces. */
function writeEdge(cpe: string, host: string, vlanInterfaces = "{}"): void {
    writeDevice(
        "edge-01",
        edgeChr!,
        `management: { allow: ["10.0.0.0/24"], ssh: {} },
    interfaces: {
        ethernet: {
            "virtual-1": { description: "Management", addresses: ["10.0.0.1/24"] },
            "virtual-2": { description: "cpe-01", ${cpe} },
            "virtual-3": { description: "host-01", ${host} },
        },
        vlan_interface: ${vlanInterfaces},
    },
    switching: { vlans: { hosts: { id: 10 } } },`
    );
}

describe.skipIf(!edgeChr || !cpeChr || !hostChr)("a CHR limits the rate through an interface", () => {
    beforeAll(() => {
        write("circuit.ts", `export const lab = circuit({ sites: { lab: { description: "Three CHRs, linked port to port." } } });\n`);

        writeEdge(
            `addresses: ["192.0.2.1/30"], rate_limit: { input: "${INPUT_KBPS}k", output: { cir: "${OUTPUT_KBPS}k", bc: 10_000 } }`,
            `addresses: ["198.51.100.1/30"]`
        );
        writeDevice(
            "cpe-01",
            cpeChr!,
            `management: { allow: ["10.0.1.0/24"], ssh: {} },
    interfaces: {
        ethernet: {
            "virtual-1": { description: "Management", addresses: ["10.0.1.1/24"] },
            "virtual-2": { description: "edge-01", addresses: ["${CPE}/30"] },
        },
    },
    routing: { static_routes: [{ prefix: "198.51.100.0/30", next_hop: "192.0.2.1" }] },`
        );
        writeDevice(
            "host-01",
            hostChr!,
            `management: { allow: ["10.0.2.0/24"], ssh: {} },
    interfaces: {
        ethernet: {
            "virtual-1": { description: "Management", addresses: ["10.0.2.1/24"] },
            "virtual-2": { description: "edge-01", addresses: ["${HOST}/30"] },
        },
    },
    routing: { static_routes: [{ prefix: "192.0.2.0/30", next_hop: "198.51.100.1" }] },`
        );
    });

    afterAll(() => rmSync(folder, { recursive: true, force: true }));

    test(
        "the port's queue is set, and diff then finds nothing to change",
        async () => {
            for (const device of ["cpe-01", "host-01", "edge-01"]) {
                circuit("diff", device);
                expect(circuit("apply", device, "--confirm").status).toBe(0);
                expect(circuit("diff", device).status).toBe(0);
            }
            circuit("exec", "edge-01", "/queue simple print detail");

            // A bandwidth test needs its server, which Circuit turns off.
            for (const chr of [cpeChr!, hostChr!]) await onChr(chr, "/tool bandwidth-server set enabled=yes authenticate=no");
        },
        TEST_MS
    );

    test(
        "what arrives from cpe-01, and what leaves to it, stays under the port's limits",
        async () => {
            const fromCpe = await received(hostChr!, CPE);
            const toCpe = await received(cpeChr!, HOST);

            expect(fromCpe).toBeGreaterThan(0);
            expect(fromCpe).toBeLessThan(INPUT_KBPS * KBIT * MARGIN);
            expect(toCpe).toBeGreaterThan(INPUT_KBPS * KBIT * MARGIN);
            expect(toCpe).toBeLessThan(OUTPUT_KBPS * KBIT * MARGIN);
        },
        TEST_MS
    );

    test(
        "a VLAN interface's queue limits what arrives from host-01",
        async () => {
            writeEdge(
                `addresses: ["192.0.2.1/30"]`,
                `access_vlan: "hosts"`,
                `{ hosts: { vlan: "hosts", addresses: ["198.51.100.1/30"], rate_limit: { input: "${INPUT_KBPS}k" } } }`
            );
            expect(circuit("apply", "edge-01", "--confirm").status).toBe(0);
            expect(circuit("diff", "edge-01").status).toBe(0);

            const fromHost = await received(cpeChr!, HOST);
            expect(fromHost).toBeGreaterThan(0);
            expect(fromHost).toBeLessThan(INPUT_KBPS * KBIT * MARGIN);
        },
        TEST_MS
    );
});
