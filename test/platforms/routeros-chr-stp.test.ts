// Three RouterOS CHRs, which the devices workflow boots, the first linked to the other two. Each runs RSTP on its bridge, and r-01's port toward r-02 has `stp: false`. Skipped without the three CHRs.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/** Each CHR's SSH, and r-01's REST API, as `host:port`. Each has the user `operator`, with the password in CIRCUIT_TEST_CHR_PASSWORD. */
const firstChr = process.env.CIRCUIT_TEST_CHR;
const firstRest = process.env.CHR_REST;
const secondChr = process.env.CIRCUIT_TEST_CHR_B;
const thirdChr = process.env.CIRCUIT_TEST_CHR_C;
const password = process.env.CIRCUIT_TEST_CHR_PASSWORD ?? "";

const repo = join(import.meta.dir, "..", "..");
const folder = realpathSync(mkdtempSync(join(tmpdir(), "circuit-chr-stp-")));

/** A test applies to three routers. */
const TEST_MS = 300_000;

/** The destination of spanning tree BPDUs, alone and with the mask of a whole MAC address. */
const BPDU_ADDRESS = "01:80:C2:00:00:00";
const BPDU = `${BPDU_ADDRESS}/FF:FF:FF:FF:FF:FF`;

/** How long a router listens for BPDUs: a designated port sends one every 2 seconds. */
const LISTEN_S = 8;

/** r-02 has the best bridge priority, r-01 the default, and r-03 the worst. */
const PRIORITY = { second: 4096, third: 61440 };

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

/** r-01, whose port toward r-02 takes no part in spanning tree while `outOfStp`. */
function writeFirst(outOfStp: boolean): void {
    writeDevice(
        "r-01",
        firstChr!,
        `management: { allow: ["10.0.0.0/24"], ssh: {} },
    interfaces: {
        ethernet: {
            "virtual-1": { description: "Management", addresses: ["10.0.0.1/24"] },
            "virtual-2": { description: "r-02", access_vlan: "lan"${outOfStp ? ", stp: false" : ""} },
            "virtual-3": { description: "r-03", access_vlan: "lan" },
        },
    },
    switching: { stp: {}, vlans: { lan: { id: 10 } } },`
    );
}

/** r-02 or r-03, with one port toward r-01. */
function writeNeighbor(name: string, chr: string, network: string, priority: number): void {
    writeDevice(
        name,
        chr,
        `management: { allow: ["${network}.0/24"], ssh: {} },
    interfaces: {
        ethernet: {
            "virtual-1": { description: "Management", addresses: ["${network}.1/24"] },
            "virtual-2": { description: "r-01", access_vlan: "lan" },
        },
    },
    switching: { stp: { priority: ${priority} }, vlans: { lan: { id: 10 } } },`
    );
}

/** A script typed on r-01 through its REST API, as a person would type it. */
async function typed(script: string): Promise<void> {
    const response = await fetch(`http://${firstRest}/rest/execute`, {
        method: "POST",
        headers: { authorization: `Basic ${btoa(`operator:${password}`)}`, "content-type": "application/json" },
        body: JSON.stringify({ script, "as-string": "" }),
    });
    console.log(`r-01 typed ${script}: ${response.status} ${await response.text()}`);
    expect(response.ok).toBe(true);
}

/** What `exec` printed for `command` on `device`. */
function exec(device: string, command: string): string {
    const { status, output } = circuit("exec", device, command);
    expect(status).toBe(0);
    return output;
}

/** The BPDUs `device` takes on its ether2, from r-01, while it listens. The sniffer draws its list again each second, so a packet counts once by its number. */
function bpdusFromFirst(device: string): number {
    const output = exec(device, `/tool sniffer quick interface=ether2 mac-address=${BPDU_ADDRESS} duration=${LISTEN_S}s`);
    const received = new RegExp(`^ether2\\s+\\S+\\s+(\\d+)\\s+<-\\s+\\S+\\s+${BPDU_ADDRESS}\\s`, "gm");
    return new Set([...output.matchAll(received)].map(([, number]) => number)).size;
}

/** Whether r-01's bridge is its own root bridge. */
function firstIsRoot(): boolean {
    return /root-bridge: yes/.test(exec("r-01", "/interface bridge monitor bridge once"));
}

/** Waits, so a new topology settles and each designated port has sent a few BPDUs. */
function settle(): void {
    Bun.sleepSync(LISTEN_S * 1000);
}

describe.skipIf(!firstChr || !firstRest || !secondChr || !thirdChr)(
    "a CHR's port with stp: false sends no BPDUs, and ignores those it gets",
    () => {
        beforeAll(() => {
            write("circuit.ts", `export const lab = circuit({ sites: { lab: { description: "Three CHRs, linked port to port." } } });\n`);
            writeFirst(true);
            writeNeighbor("r-02", secondChr!, "10.0.1", PRIORITY.second);
            writeNeighbor("r-03", thirdChr!, "10.0.2", PRIORITY.third);
        });

        afterAll(() => rmSync(folder, { recursive: true, force: true }));

        test(
            "r-02 takes no BPDU from r-01's port with stp: false, r-03 takes them from the other, and r-01 stays its own root",
            async () => {
                // What Circuit wrote for stp: false before, which the plan removes.
                await typed(
                    `/interface bridge filter add action=drop chain=input comment="ether2 out of spanning tree" dst-mac-address=${BPDU} in-interface=ether2; /interface bridge filter add action=drop chain=output comment="ether2 out of spanning tree" dst-mac-address=${BPDU} out-interface=ether2`
                );
                for (const device of ["r-02", "r-03", "r-01"]) {
                    circuit("diff", device);
                    expect(circuit("apply", device, "--confirm").status).toBe(0);
                    expect(circuit("diff", device).status).toBe(0);
                }
                expect(exec("r-01", ":put [:len [/interface bridge filter find]]")).toMatch(/^0$/m);
                settle();
                exec("r-01", "/interface bridge port monitor [find] once");

                // r-02's priority is better, so r-01 would take it as the root through that port. As the root, each of its ports is designated, and would send BPDUs.
                expect(firstIsRoot()).toBe(true);
                expect(bpdusFromFirst("r-02")).toBe(0);
                expect(bpdusFromFirst("r-03")).toBeGreaterThan(0);
            },
            TEST_MS
        );

        test(
            "without stp: false, apply puts the port back in spanning tree, r-01 takes r-02 as its root, and diff then finds nothing to change",
            () => {
                writeFirst(false);
                expect(circuit("apply", "r-01", "--confirm").status).toBe(0);
                expect(circuit("diff", "r-01").status).toBe(0);
                settle();
                exec("r-01", "/interface bridge port monitor [find] once");

                expect(firstIsRoot()).toBe(false);
                expect(bpdusFromFirst("r-03")).toBeGreaterThan(0);
            },
            TEST_MS
        );
    }
);
