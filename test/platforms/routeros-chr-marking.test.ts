// Three RouterOS CHRs, which the devices workflow boots, the first linked to the other two. edge-01 routes between cpe-01 and host-01, the link to host-01 a VLAN, and marks what it routes to host-01. host-01 counts what arrives by its DSCP and by the PCP of its VLAN tag, in rules added by hand. Skipped without the three CHRs.

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
const folder = realpathSync(mkdtempSync(join(tmpdir(), "circuit-chr-marking-")));

/** A test applies to three routers. */
const TEST_MS = 300_000;

/** Each family: its firewall menu, the ICMP the routers ping with, cpe-01's and host-01's addresses, and edge-01's ends of their links. */
const FAMILIES = [
    {
        menu: "/ip firewall mangle",
        icmp: "icmp",
        cpe: "192.0.2.2",
        host: "198.51.100.2",
        edgeToCpe: "192.0.2.1",
        edgeToHost: "198.51.100.1",
        length: 30,
    },
    {
        menu: "/ipv6 firewall mangle",
        icmp: "icmpv6",
        cpe: "2001:db8:2::2",
        host: "2001:db8:3::2",
        edgeToCpe: "2001:db8:2::1",
        edgeToHost: "2001:db8:3::1",
        length: 64,
    },
] as const;

/** The DSCPs and PCPs host-01 counts, by the comment of its rule. 46 is EF, 8 CS1, and 10 AF11. */
const COUNTED = { ef: "dscp=46", cs1: "dscp=8", af11: "dscp=10", cs0: "dscp=0", pcp5: "ingress-priority=5", pcp0: "ingress-priority=0" };

/** The pings cpe-01 sends host-01 in each family, of which the first may wait for the neighbor's address. */
const PINGS = 5;
const ARRIVED = 4;

/** edge-01's marking: AF11 becomes CS1, and anything else cpe-01 pings with leaves as EF with PCP 5. */
const MARKING = `qos: {
        marking: [
            { description: "Remark", if: { dscp: "af11" }, then: { dscp: "cs1" } },
            { description: "Voice", if: { in_interface: "virtual-2", protocol: "icmp" }, then: { dscp: "ef", pcp: 5 } },
        ],
    },`;

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

/** Runs a command on a CHR over SSH, for what `circuit exec` refuses: a ping, or a rule that counts. */
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

/** cpe-01 pings host-01 in both families, after one ping each that finds the neighbors, which host-01 does not count. */
async function ping(): Promise<void> {
    for (const { host } of FAMILIES) await onChr(cpeChr!, `/ping ${host} count=1`);
    for (const { menu } of FAMILIES) await onChr(hostChr!, `${menu} reset-counters-all`);
    for (const { host } of FAMILIES) await onChr(cpeChr!, `/ping ${host} count=${PINGS} interval=200ms`);
}

/** How many pings host-01 counted, by the comment of each rule, in one family. */
async function counted(menu: string): Promise<Record<keyof typeof COUNTED, number>> {
    const counts = await Promise.all(
        Object.keys(COUNTED).map(async (name) => Number(await onChr(hostChr!, `:put [${menu} get [find comment=${name}] packets]`)))
    );
    return Object.fromEntries(Object.keys(COUNTED).map((name, index) => [name, counts[index]])) as Record<keyof typeof COUNTED, number>;
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

/** The addresses of one end of a link, in both families. */
const addresses = (end: "cpe" | "host" | "edgeToCpe" | "edgeToHost") =>
    JSON.stringify(FAMILIES.map((family) => `${family[end]}/${family.length}`));

/** edge-01, with these other groups. */
function writeEdge(more: string): void {
    writeDevice(
        "edge-01",
        edgeChr!,
        `management: { allow: ["10.0.0.0/24"], ssh: {} },
    interfaces: {
        ethernet: {
            "virtual-1": { description: "Management", addresses: ["10.0.0.1/24"] },
            "virtual-2": { description: "cpe-01", addresses: ${addresses("edgeToCpe")} },
            "virtual-3": { description: "host-01", trunk_vlans: ["hosts"] },
        },
        vlan_interface: { hosts: { vlan: "hosts", addresses: ${addresses("edgeToHost")} } },
    },
    switching: { vlans: { hosts: { id: 10 } } },
    ${more}`
    );
}

describe.skipIf(!edgeChr || !cpeChr || !hostChr)("a CHR marks what it routes", () => {
    beforeAll(() => {
        write("circuit.ts", `export const lab = circuit({ sites: { lab: { description: "Three CHRs, linked port to port." } } });\n`);

        writeEdge(MARKING);
        writeDevice(
            "cpe-01",
            cpeChr!,
            `management: { allow: ["10.0.1.0/24"], ssh: {} },
    interfaces: {
        ethernet: {
            "virtual-1": { description: "Management", addresses: ["10.0.1.1/24"] },
            "virtual-2": { description: "edge-01", addresses: ${addresses("cpe")} },
        },
    },
    routing: {
        static_routes: [
            { prefix: "198.51.100.0/30", next_hop: "192.0.2.1" },
            { prefix: "2001:db8:3::/64", next_hop: "2001:db8:2::1" },
        ],
    },`
        );
        writeDevice(
            "host-01",
            hostChr!,
            `management: { allow: ["10.0.2.0/24"], ssh: {} },
    interfaces: {
        ethernet: {
            "virtual-1": { description: "Management", addresses: ["10.0.2.1/24"] },
            "virtual-2": { description: "edge-01", trunk_vlans: ["hosts"] },
        },
        vlan_interface: { hosts: { vlan: "hosts", addresses: ${addresses("host")} } },
    },
    switching: { vlans: { hosts: { id: 10 } } },
    routing: {
        static_routes: [
            { prefix: "192.0.2.0/30", next_hop: "198.51.100.1" },
            { prefix: "2001:db8:2::/64", next_hop: "2001:db8:3::1" },
        ],
    },`
        );
    });

    afterAll(() => rmSync(folder, { recursive: true, force: true }));

    test(
        "the marking rules are set, and diff then finds nothing to change",
        async () => {
            for (const device of ["cpe-01", "host-01", "edge-01"]) {
                circuit("diff", device);
                expect(circuit("apply", device, "--confirm").status).toBe(0);
                expect(circuit("diff", device).status).toBe(0);
            }
            circuit("exec", "edge-01", "/ip firewall mangle print detail");
            circuit("exec", "edge-01", "/ipv6 firewall mangle print detail");

            // Counted on the way in, only what cpe-01 sends, so neighbor discovery between the routers is left out.
            for (const { menu, icmp, cpe } of FAMILIES)
                for (const [name, match] of Object.entries(COUNTED))
                    await onChr(
                        hostChr!,
                        `${menu} add chain=prerouting protocol=${icmp} src-address=${cpe} ${match} action=passthrough comment=${name}`
                    );
        },
        TEST_MS
    );

    test(
        "a ping leaves edge-01 with EF, and with PCP 5 in its VLAN tag",
        async () => {
            await ping();
            for (const { menu } of FAMILIES) {
                const seen = await counted(menu);
                expect(seen.ef).toBeGreaterThanOrEqual(ARRIVED);
                expect(seen.cs0).toBe(0);
                expect(seen.pcp5).toBe(seen.ef);
                expect(seen.pcp0).toBe(0);
            }
        },
        TEST_MS
    );

    test(
        "a ping that arrives with AF11 leaves with CS1, and the first rule that matches is the only one",
        async () => {
            // cpe-01 marks its own pings, as `/ping dscp=` marks no IPv6 ping (TRAPS.md).
            for (const { menu, icmp } of FAMILIES)
                await onChr(cpeChr!, `${menu} add chain=output protocol=${icmp} action=change-dscp new-dscp=10 comment=af11`);
            await ping();
            for (const { menu } of FAMILIES) await onChr(cpeChr!, `${menu} remove [find comment=af11]`);

            for (const { menu } of FAMILIES) {
                const seen = await counted(menu);
                expect(seen.cs1).toBeGreaterThanOrEqual(ARRIVED);
                expect(seen.af11).toBe(0);
                expect(seen.ef).toBe(0);
                expect(seen.pcp0).toBe(seen.cs1);
            }
        },
        TEST_MS
    );

    test(
        "without marking, the rules are removed and a ping keeps its DSCP",
        async () => {
            writeEdge("");
            const planned = circuit("diff", "edge-01");
            expect(planned.status).toBe(1);
            expect(planned.output).toContain("change-dscp");
            expect(circuit("apply", "edge-01", "--confirm").status).toBe(0);
            expect(circuit("diff", "edge-01").status).toBe(0);
            for (const { menu } of FAMILIES) expect((await onChr(edgeChr!, `:put [:len [${menu} find]]`)).trim()).toBe("0");

            await ping();
            for (const { menu } of FAMILIES) {
                const seen = await counted(menu);
                expect(seen.cs0).toBeGreaterThanOrEqual(ARRIVED);
                expect(seen.ef).toBe(0);
                expect(seen.pcp0).toBe(seen.cs0);
            }
        },
        TEST_MS
    );
});
