// Three RouterOS CHRs, which the devices workflow boots, the first linked to the other two. edge-01 runs Netwatch probes: to cpe-01 over IPv4 and IPv6, to host-01 in a VRF, and to an address nothing answers. Each comes up or goes down, a change converges, and a removed probe is gone. Skipped without the three CHRs.

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
const folder = realpathSync(mkdtempSync(join(tmpdir(), "circuit-chr-probes-")));

/** A test applies to three routers, and waits for the probes. */
const TEST_MS = 600_000;

/** How long the probes have to settle. Netwatch starts no probe until 5 minutes after the router boots (TRAPS.md). */
const WAIT_MS = 420_000;

const POLL_MS = 5000;

const VRF = "lab";
/** edge-01's ends of its links, and the far ends. */
const EDGE = { v4: "192.0.2.1", v6: "2001:db8:0:1::1", vrf: "192.0.2.5" };
const CPE = { v4: "192.0.2.2", v6: "2001:db8:0:1::2" };
const HOST = "192.0.2.6";
/** Addresses nothing answers: edge-01 has no route to them. */
const NOWHERE = ["203.0.113.9", "198.51.100.9"];

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
    ${groups}
});
`
    );
}

/** edge-01 with these probes, or none. */
function writeEdge(probes: string | undefined): void {
    writeDevice(
        "edge-01",
        edgeChr!,
        `system: { users: { operator: { role: "admin", password: secret("OPERATOR_PASSWORD") } } },
    management: { allow: ["10.0.0.0/24"], ssh: {} },
    ${probes ? `monitoring: { probes: ${probes} },` : ""}
    interfaces: {
        ethernet: {
            "virtual-1": { description: "Management", addresses: ["10.0.0.1/24"] },
            "virtual-2": { description: "cpe-01", addresses: ["${EDGE.v4}/30", "${EDGE.v6}/64"] },
            "virtual-3": { description: "host-01", addresses: ["${EDGE.vrf}/30"], vrf: "${VRF}" },
        },
    },
    routing: { vrfs: { "${VRF}": { description: "host-01's link" } } },`
    );
}

/** Each probe's status on edge-01, by name: `up`, `down`, or `unknown`. */
function statuses(): Record<string, string> {
    const printed = circuit("exec", "edge-01", "/tool netwatch print terse without-paging").output;
    const found: Record<string, string> = {};
    for (const line of printed.split("\n")) {
        const entry = /name=(\S+) .*status=(\w+)/.exec(line);
        if (entry) found[entry[1]!] = entry[2]!;
    }
    return found;
}

/** Applies edge-01, and says whether `diff` then finds nothing to change. */
function converges(): boolean {
    circuit("diff", "edge-01");
    expect(circuit("apply", "edge-01", "--confirm").status).toBe(0);
    return circuit("diff", "edge-01").status === 0;
}

describe.skipIf(!edgeChr || !cpeChr || !hostChr)("Netwatch probes on a CHR", () => {
    beforeAll(() => {
        write("circuit.ts", `export const lab = circuit({ sites: { lab: { description: "Three CHRs, linked port to port." } } });\n`);

        writeEdge(
            `{
        "to-cpe": { target: "${CPE.v4}", interval: 5 },
        "to-cpe-v6": { target: "${CPE.v6}", interval: 5, source_address: "${EDGE.v6}" },
        "to-host": { target: "${HOST}", interval: 5, source_address: "${EDGE.vrf}", vrf: "${VRF}" },
        nowhere: { target: "${NOWHERE[0]}", interval: 5 },
    }`
        );
        writeDevice(
            "cpe-01",
            cpeChr!,
            `system: { users: { operator: { role: "admin", password: secret("OPERATOR_PASSWORD") } } },
    management: { allow: ["10.0.1.0/24"], ssh: {} },
    interfaces: {
        ethernet: {
            "virtual-1": { description: "Management", addresses: ["10.0.1.1/24"] },
            "virtual-2": { description: "edge-01", addresses: ["${CPE.v4}/30", "${CPE.v6}/64"] },
        },
    },`
        );
        writeDevice(
            "host-01",
            hostChr!,
            `system: { users: { operator: { role: "admin", password: secret("OPERATOR_PASSWORD") } } },
    management: { allow: ["10.0.2.0/24"], ssh: {} },
    interfaces: {
        ethernet: {
            "virtual-1": { description: "Management", addresses: ["10.0.2.1/24"] },
            "virtual-2": { description: "edge-01", addresses: ["${HOST}/30"] },
        },
    },`
        );
    });

    afterAll(() => rmSync(folder, { recursive: true, force: true }));

    test(
        "the probes are set, and diff then finds nothing to change",
        () => {
            for (const device of ["cpe-01", "host-01"]) {
                circuit("diff", device);
                expect(circuit("apply", device, "--confirm").status).toBe(0);
                expect(circuit("diff", device).status).toBe(0);
            }
            expect(converges()).toBe(true);
            circuit("exec", "edge-01", "/tool netwatch export");
        },
        TEST_MS
    );

    test(
        "a probe to an address that answers comes up, and one to an address nothing answers goes down",
        () => {
            const expected = { "to-cpe": "up", "to-cpe-v6": "up", "to-host": "up", nowhere: "down" };
            const settled = () => {
                const found = statuses();
                return Object.entries(expected).every(([name, status]) => found[name] === status);
            };
            const ok = eventually(settled);
            circuit("exec", "edge-01", "/tool netwatch print detail without-paging");
            expect(ok ? expected : statuses()).toEqual(expected);
        },
        TEST_MS
    );

    test(
        "a changed probe converges, and a removed one is gone",
        () => {
            // Another interval and a source for one, no source for another, a new target for a third, and one fewer.
            writeEdge(
                `{
        "to-cpe": { target: "${CPE.v4}", interval: 7, source_address: "${EDGE.v4}" },
        "to-host": { target: "${HOST}", interval: 5, vrf: "${VRF}" },
        nowhere: { target: "${NOWHERE[1]}", interval: 60 },
    }`
            );
            expect(converges()).toBe(true);
            circuit("exec", "edge-01", "/tool netwatch export");

            writeEdge(undefined);
            expect(converges()).toBe(true);
            expect(statuses()).toEqual({});
        },
        TEST_MS
    );
});
