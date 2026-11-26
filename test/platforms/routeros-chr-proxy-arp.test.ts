// Three RouterOS CHRs, which the devices workflow boots, the first linked to the other two. r-02 shares a subnet with r-01's VLAN interface, and r-03 holds an address of that subnet on its loopback. With the address in the VLAN interface's `proxy_arp`, r-01 answers r-02's ARP for it and routes its traffic to r-03, in the main table, then in a VRF. Skipped without the three CHRs.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Ssh } from "../../src/transport/ssh";

/** Each CHR's SSH, as `host:port`. Each has the user `operator`, with the password in CIRCUIT_TEST_CHR_PASSWORD. */
const middleChr = process.env.CIRCUIT_TEST_CHR;
const secondChr = process.env.CIRCUIT_TEST_CHR_B;
const thirdChr = process.env.CIRCUIT_TEST_CHR_C;
const password = process.env.CIRCUIT_TEST_CHR_PASSWORD ?? "";

const repo = join(import.meta.dir, "..", "..");
const folder = realpathSync(mkdtempSync(join(tmpdir(), "circuit-chr-proxy-arp-")));

/** A test applies to three routers. */
const TEST_MS = 300_000;

/** r-01's VLAN interface and r-02 share the subnet. The moved address is in it, on r-03's loopback, which r-01 reaches across their own link. */
const SUBNET_GATEWAY = "192.0.2.1/24";
const SUBNET_HOST = "192.0.2.2/24";
const MOVED = "192.0.2.50";
const LINK = { middle: "198.51.100.1/30", far: "198.51.100.2/30" };

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

/** Runs a command on a CHR over SSH, for what `circuit exec` refuses: forgetting an ARP entry. */
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

/** The VRF r-01 routes the subnet and its link to r-03 in, when a test asks for one. */
const VRF = "lab";

/** r-01, with the subnet on a VLAN interface whose port carries it untagged, and `proxyArp` as its addresses for proxy ARP. With `inVrf`, the VLAN interface, the link to r-03, and the route are in a VRF. */
function writeMiddle(proxyArp: string, inVrf = false): void {
    const vrf = inVrf ? `vrf: "${VRF}", ` : "";
    writeDevice(
        "r-01",
        middleChr!,
        `management: { allow: ["10.0.0.0/24"], ssh: {} },
    interfaces: {
        ethernet: {
            "virtual-1": { description: "Management", addresses: ["10.0.0.1/24"] },
            "virtual-2": { description: "r-02", access_vlan: "hosts" },
            "virtual-3": { description: "r-03", addresses: ["${LINK.middle}"], ${vrf}},
        },
        vlan_interface: { hosts: { vlan: "hosts", addresses: ["${SUBNET_GATEWAY}"], ${vrf}${proxyArp} } },
    },
    switching: { vlans: { hosts: { id: 10 } } },
    routing: {
        ${inVrf ? `vrfs: { "${VRF}": { description: "The hosts' subnet" } },` : ""}
        static_routes: [{ prefix: "${MOVED}/32", next_hop: "${LINK.far.split("/")[0]}", ${vrf}}],
    },`
    );
}

/** What `exec` printed for `command` on `device`. */
function exec(device: string, command: string): string {
    const { status, output } = circuit("exec", device, command);
    expect(status).toBe(0);
    return output;
}

/** Whether r-02 reaches the moved address, after it forgets what it learned of it. */
async function reachesMoved(): Promise<boolean> {
    await onChr(secondChr!, `/ip arp remove [find where dynamic and address="${MOVED}"]`);
    return /received=[1-9]/.test(exec("r-02", `/ping ${MOVED} count=3`));
}

describe.skipIf(!middleChr || !secondChr || !thirdChr)("a CHR answers ARP for an address of its subnet that is somewhere else", () => {
    beforeAll(() => {
        write("circuit.ts", `export const lab = circuit({ sites: { lab: { description: "Three CHRs, linked port to port." } } });\n`);
        writeMiddle("");
        writeDevice(
            "r-02",
            secondChr!,
            `management: { allow: ["10.0.1.0/24"], ssh: {} },
    interfaces: {
        ethernet: {
            "virtual-1": { description: "Management", addresses: ["10.0.1.1/24"] },
            "virtual-2": { description: "r-01", addresses: ["${SUBNET_HOST}"] },
        },
    },`
        );
        writeDevice(
            "r-03",
            thirdChr!,
            `management: { allow: ["10.0.2.0/24"], ssh: {} },
    interfaces: {
        ethernet: {
            "virtual-1": { description: "Management", addresses: ["10.0.2.1/24"] },
            "virtual-2": { description: "r-01", addresses: ["${LINK.far}"] },
        },
        loopback: { loopback: { addresses: ["${MOVED}/32"] } },
    },
    routing: { static_routes: [{ prefix: "192.0.2.0/24", next_hop: "${LINK.middle.split("/")[0]}" }] },`
        );
    });

    afterAll(() => rmSync(folder, { recursive: true, force: true }));

    test(
        "without proxy ARP, r-02 asks for the moved address in its subnet, and nothing answers",
        async () => {
            for (const device of ["r-02", "r-03", "r-01"]) {
                circuit("diff", device);
                expect(circuit("apply", device, "--confirm").status).toBe(0);
                expect(circuit("diff", device).status).toBe(0);
            }
            expect(await reachesMoved()).toBe(false);
        },
        TEST_MS
    );

    test(
        "with the address in proxy_arp, r-01 answers for it with its own MAC address and routes it to r-03, and diff then finds nothing to change",
        async () => {
            writeMiddle(`proxy_arp: ["${MOVED}"]`);
            expect(circuit("apply", "r-01", "--confirm").status).toBe(0);
            expect(circuit("diff", "r-01").status).toBe(0);
            exec("r-01", "/ip arp print detail without-paging where !dynamic");

            expect(await reachesMoved()).toBe(true);
            const mac = exec("r-01", ":put [/interface get hosts mac-address]").match(/(?:[\dA-F]{2}:){5}[\dA-F]{2}/)?.[0];
            expect(mac).toBeDefined();
            expect(exec("r-02", `/ip arp print detail without-paging where address="${MOVED}"`)).toContain(`mac-address=${mac}`);
        },
        TEST_MS
    );

    test(
        "in a VRF, r-01 answers for the address the same way, and diff then finds nothing to change",
        async () => {
            writeMiddle(`proxy_arp: ["${MOVED}"]`, true);
            expect(circuit("apply", "r-01", "--confirm").status).toBe(0);
            expect(circuit("diff", "r-01").status).toBe(0);
            exec("r-01", "/ip arp print detail without-paging where !dynamic");

            expect(await reachesMoved()).toBe(true);
        },
        TEST_MS
    );

    test(
        "without it again, and without the VRF, apply removes the entry, and nothing answers for the address",
        async () => {
            writeMiddle("");
            expect(circuit("apply", "r-01", "--confirm").status).toBe(0);
            expect(circuit("diff", "r-01").status).toBe(0);
            expect(exec("r-01", ":put [:len [/ip arp find where !dynamic]]")).toMatch(/^0$/m);
            expect(await reachesMoved()).toBe(false);
        },
        TEST_MS
    );
});
