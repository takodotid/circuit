// Three RouterOS CHRs, which the devices workflow boots, the first linked to the other two, and the second to the third. Each runs RSTP on its bridge. r-01's port toward r-02 has `stp: false`, then is an edge port. Skipped without the three CHRs.

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
const withoutChrs = !firstChr || !firstRest || !secondChr || !thirdChr;

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

/** How long r-01's ether2 stays down, and when its bridge port is looked at once it is up. Toward a host, a port without `edge` waited about 2.7 seconds before it forwarded. By then it had found by itself that it is an edge port (CHR, 7.24.6). */
const DOWN_S = 2;
const FIRST_LOOK_MS = 250;

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

/** The lab project's network. */
function writeNetwork(): void {
    write("circuit.ts", `export const lab = circuit({ sites: { lab: { description: "Three CHRs, linked port to port." } } });\n`);
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

/** r-01, with this `stp` on its port toward r-02, or none. Its REST API answers once it runs this config. */
function writeFirst(stp?: string): void {
    writeDevice(
        "r-01",
        firstChr!,
        `management: { allow: ["10.0.0.0/24"], ssh: {}, http: {} },
    interfaces: {
        ethernet: {
            "virtual-1": { description: "Management", addresses: ["10.0.0.1/24"] },
            "virtual-2": { description: "r-02", access_vlan: "lan"${stp ? `, stp: ${stp}` : ""} },
            "virtual-3": { description: "r-03", access_vlan: "lan" },
        },
    },
    switching: { stp: {}, vlans: { lan: { id: 10 } } },`
    );
}

/** r-02 or r-03, with its port toward r-01, an edge port with `edge`, and with `loop` its port toward the other too. Without `priority` it runs no spanning tree, so to r-01 it is a host. */
function writeNeighbor(
    name: "r-02" | "r-03",
    chr: string,
    network: string,
    { priority, edge, loop }: { priority?: number; edge?: boolean; loop?: boolean }
): void {
    const other = name === "r-02" ? "r-03" : "r-02";
    writeDevice(
        name,
        chr,
        `management: { allow: ["${network}.0/24"], ssh: {} },
    interfaces: {
        ethernet: {
            "virtual-1": { description: "Management", addresses: ["${network}.1/24"] },
            "virtual-2": { description: "r-01", access_vlan: "lan"${edge ? ", stp: { edge: true }" : ""} },${loop ? `\n            "virtual-3": { description: "${other}", access_vlan: "lan" },` : ""}
        },
    },
    switching: { ${priority === undefined ? "" : `stp: { priority: ${priority} }, `}vlans: { lan: { id: 10 } } },`
    );
}

/** A script typed on r-01 through its REST API, as a person would type it, and what it printed. */
async function typed(script: string): Promise<string> {
    const response = await fetch(`http://${firstRest}/rest/execute`, {
        method: "POST",
        headers: { authorization: `Basic ${btoa(`operator:${password}`)}`, "content-type": "application/json" },
        body: JSON.stringify({ script, "as-string": "" }),
    });
    const text = await response.text();
    console.log(`r-01 typed ${script}: ${response.status} ${text}`);
    expect(response.ok).toBe(true);
    return (JSON.parse(text) as { ret?: string }).ret ?? "";
}

/** What `exec` printed for `command` on `device`. */
function exec(device: string, command: string): string {
    const { status, output } = circuit("exec", device, command);
    expect(status).toBe(0);
    return output;
}

/** Applies each device's config, and checks that diff then finds nothing to change. */
function apply(...devices: string[]): void {
    for (const device of devices) {
        circuit("diff", device);
        expect(circuit("apply", device, "--confirm").status).toBe(0);
        expect(circuit("diff", device).status).toBe(0);
    }
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

/** How `device` sees the bridge port of its ether2, by the names `/interface bridge port monitor` prints: `role`, `edge-port`, `forwarding`. A disabled port prints its `status` alone. */
function bridgePort(device: string): Record<string, string> {
    const output = exec(device, "/interface bridge port monitor [find interface=ether2] once");
    return Object.fromEntries([...output.matchAll(/^\s*([a-z-]+): (\S*)/gm)].map(([, name, value]) => [name, value]));
}

/** r-01's ether2 goes down and up, as when a host is plugged into it, and how r-01 sees its bridge port a moment after it is up. Values are `true` and `false` here. */
async function firstLookAfterUp(): Promise<Record<string, string>> {
    const printed = await typed(
        `/interface ethernet disable ether2; :delay ${DOWN_S}s; /interface ethernet enable ether2; :delay ${FIRST_LOOK_MS}ms; :put [/interface bridge port monitor [find interface=ether2] once as-value]`
    );
    return Object.fromEntries(
        printed
            .trim()
            .split(";")
            .map((pair) => pair.split("=", 2))
    );
}

/** Waits, so a new topology settles and each designated port has sent a few BPDUs. */
function settle(): void {
    Bun.sleepSync(LISTEN_S * 1000);
}

afterAll(() => rmSync(folder, { recursive: true, force: true }));

describe.skipIf(withoutChrs)("a CHR's port with stp: false sends no BPDUs, and ignores those it gets", () => {
    beforeAll(() => {
        writeNetwork();
        writeFirst("false");
        writeNeighbor("r-02", secondChr!, "10.0.1", { priority: PRIORITY.second });
        writeNeighbor("r-03", thirdChr!, "10.0.2", { priority: PRIORITY.third });
    });

    test(
        "r-02 takes no BPDU from r-01's port with stp: false, r-03 takes them from the other, and r-01 stays its own root",
        () => {
            apply("r-02", "r-03", "r-01");
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
        "apply removes the bridge filter rules Circuit wrote for stp: false before, and diff then finds nothing to change",
        async () => {
            await typed(
                `/interface bridge filter add action=drop chain=input comment="ether2 out of spanning tree" dst-mac-address=${BPDU} in-interface=ether2; /interface bridge filter add action=drop chain=output comment="ether2 out of spanning tree" dst-mac-address=${BPDU} out-interface=ether2`
            );
            expect(circuit("diff", "r-01").status).not.toBe(0);
            expect(circuit("apply", "r-01", "--confirm").status).toBe(0);
            expect(circuit("diff", "r-01").status).toBe(0);
            expect(exec("r-01", ":put [:len [/interface bridge filter find]]")).toMatch(/^0$/m);
        },
        TEST_MS
    );

    test(
        "without stp: false, apply puts the port back in spanning tree, r-01 takes r-02 as its root, and diff then finds nothing to change",
        () => {
            writeFirst();
            apply("r-01");
            settle();
            exec("r-01", "/interface bridge port monitor [find] once");

            expect(firstIsRoot()).toBe(false);
            expect(bpdusFromFirst("r-03")).toBeGreaterThan(0);
        },
        TEST_MS
    );
});

describe.skipIf(withoutChrs)(
    "a CHR's edge port forwards at once and sends BPDUs, and the first BPDU it gets puts it in spanning tree",
    () => {
        beforeAll(() => {
            writeNetwork();
            writeNeighbor("r-03", thirdChr!, "10.0.2", { priority: PRIORITY.third });
        });

        test(
            "toward a host, r-01's edge port forwards as soon as it is up, where a port without edge waits, and it sends BPDUs",
            async () => {
                writeNeighbor("r-02", secondChr!, "10.0.1", {});
                writeFirst();
                apply("r-02", "r-01");
                expect(await firstLookAfterUp()).toMatchObject({ role: "designated-port", "edge-port": "false", forwarding: "false" });

                writeFirst("{ edge: true }");
                apply("r-01");
                expect(await firstLookAfterUp()).toMatchObject({ role: "designated-port", "edge-port": "true", forwarding: "true" });
                expect(exec("r-01", "/interface bridge port export")).toContain("edge=yes-discover");

                // r-02 runs no spanning tree, so each BPDU it takes is r-01's. An edge port without discovery sent none (TRAPS.md).
                expect(bpdusFromFirst("r-02")).toBeGreaterThan(0);
            },
            TEST_MS
        );

        test(
            "once r-02 sends BPDUs with a better priority, r-01's edge port is an edge port no more, and is its root port",
            () => {
                writeNeighbor("r-02", secondChr!, "10.0.1", { priority: PRIORITY.second });
                apply("r-02");
                settle();

                expect(bridgePort("r-01")).toMatchObject({ role: "root-port", "edge-port": "no", forwarding: "yes" });
                expect(firstIsRoot()).toBe(false);
                expect(circuit("diff", "r-01").status).toBe(0);
            },
            TEST_MS
        );

        test(
            "in a loop, r-03's edge port toward r-01 takes r-01's BPDUs and blocks",
            () => {
                // r-02 is the root, and r-03 reaches it through its own port toward r-02. On the link between r-01 and r-03, r-01 has the better priority.
                writeNeighbor("r-02", secondChr!, "10.0.1", { priority: PRIORITY.second, loop: true });
                writeNeighbor("r-03", thirdChr!, "10.0.2", { priority: PRIORITY.third, loop: true, edge: true });
                apply("r-02", "r-03");
                settle();

                expect(bridgePort("r-03")).toMatchObject({ role: "alternate-port", "edge-port": "no", forwarding: "no" });
            },
            TEST_MS
        );

        test(
            "BPDU guard beside the edge port shuts it at the first BPDU, and diff then finds nothing to change",
            () => {
                writeFirst("{ edge: true, bpdu_guard: true }");
                apply("r-01");
                settle();

                expect(exec("r-01", '/log print where message~"bpdu-guard"')).toContain("bpdu-guard disabling ether2 due to received bpdu");
                expect(bridgePort("r-01")).toMatchObject({ status: "inactive" });
                expect(circuit("diff", "r-01").status).toBe(0);
            },
            TEST_MS
        );

        test(
            "apply turns an edge port without discovery, as Circuit wrote it before, into one with it, and the port is in spanning tree again",
            async () => {
                writeFirst("{ edge: true }");
                apply("r-01");
                await typed("/interface bridge port set [find interface=ether2] edge=yes");

                const diff = circuit("diff", "r-01");
                expect(diff.status).not.toBe(0);
                expect(diff.output).toContain("edge=yes-discover");
                apply("r-01");
                settle();

                expect(bridgePort("r-01")).toMatchObject({ role: "root-port", "edge-port": "no", forwarding: "yes" });
            },
            TEST_MS
        );
    }
);
