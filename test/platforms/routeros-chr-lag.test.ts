// A RouterOS CHR, which the devices workflow boots. Two of edge-01's ports move from the bridge into a LAG, one of them back and in again, then both back, each move in one apply (#340). Skipped without the CHR.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/** The CHR's SSH, as `host:port`. Its user `operator` has the password in CIRCUIT_TEST_CHR_PASSWORD. */
const edgeChr = process.env.CIRCUIT_TEST_CHR;
const password = process.env.CIRCUIT_TEST_CHR_PASSWORD ?? "";

const repo = join(import.meta.dir, "..", "..");
const folder = realpathSync(mkdtempSync(join(tmpdir(), "circuit-chr-lag-")));

/** A test applies five times. */
const TEST_MS = 300_000;

/** Each port as a switched port, or as a member of the LAG. */
const IN_BRIDGE = {
    "virtual-3": `{ description: "host-01", trunk_vlans: ["lab"] }`,
    "virtual-4": `{ description: "Lab hosts", access_vlan: "lab" }`,
};
const IN_LAG = {
    "virtual-3": `{ description: "host-01", in_lag: "lag-1" }`,
    "virtual-4": `{ description: "Lab hosts", in_lag: "lag-1" }`,
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

/** A file of the lab project. */
function write(path: string, text: string): void {
    mkdirSync(dirname(join(folder, path)), { recursive: true });
    writeFileSync(join(folder, path), text);
}

/** edge-01 with these two ports, and the LAG when a port is in it. */
function writeEdge(ports: { "virtual-3": string; "virtual-4": string }): void {
    const [host, port] = edgeChr!.split(":");
    const lag = Object.values(ports).some((settings) => settings.includes("in_lag"))
        ? `lag: { "lag-1": { description: "host-01", trunk_vlans: ["lab"] } },`
        : "";
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
            "virtual-3": ${ports["virtual-3"]},
            "virtual-4": ${ports["virtual-4"]},
        },
        ${lag}
    },
    switching: { vlans: { lab: { id: 10 } } },
});
`
    );
}

/** Applies edge-01 as written, and checks that it then matches. */
function converges(): void {
    expect(circuit("apply", "edge-01", "--confirm").status).toBe(0);
    expect(circuit("diff", "edge-01").status).toBe(0);
    circuit("exec", "edge-01", "/interface bridge port print terse", "/interface bonding print terse");
}

describe.skipIf(!edgeChr)("a CHR whose ports move between the bridge and a LAG", () => {
    beforeAll(() => {
        write("circuit.ts", `export const lab = circuit({ sites: { lab: { description: "A CHR." } } });\n`);
    });

    afterAll(() => rmSync(folder, { recursive: true, force: true }));

    test(
        "each move takes one apply, and diff then finds nothing to change",
        () => {
            writeEdge(IN_BRIDGE);
            converges();

            // Both leave the bridge for a new LAG.
            writeEdge(IN_LAG);
            converges();

            // One leaves the LAG, which stays, for the bridge, then joins it again.
            writeEdge({ ...IN_LAG, "virtual-4": IN_BRIDGE["virtual-4"] });
            converges();
            writeEdge(IN_LAG);
            converges();

            // Both go back to the bridge, and the LAG goes.
            writeEdge(IN_BRIDGE);
            converges();
        },
        TEST_MS
    );
});
