// Three RouterOS CHRs, which the devices workflow boots, the first linked to the other two. edge-01 shares a pool among subscribers (RFC 7422): cpe-01 is one of them, and host-01 stands for the internet, with a route to the pool alone. Skipped without the three CHRs.

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
const folder = realpathSync(mkdtempSync(join(tmpdir(), "circuit-chr-cgnat-")));

/** A test applies to three routers, and waits for traffic. */
const TEST_MS = 300_000;

/** How long translated traffic has to show. */
const WAIT_MS = 60_000;

const POLL_MS = 3000;

/** 64 subscribers on 4 pool addresses: 16 on each, with 4032 ports each, which fills 1024 to 65535. */
const SUBSCRIBERS = "100.64.0.0/26";
const POOL = "198.51.100.0/30";
const PORT_SET_SIZE = 4032;

/** cpe-01 is subscriber 18: the second pool address takes subscribers 16 to 31, and its third block is 18's. */
const CPE = "100.64.0.18";
const CPE_POOL_ADDRESS = "198.51.100.1";
const CPE_PORTS = { min: 9088, max: 13119 };

/** edge-01's end of the subscribers' network, and of its link to host-01. */
const EDGE = "100.64.0.1";
const EDGE_UPLINK = "203.0.113.1";
const HOST = "203.0.113.2";

/** Each connection edge-01 tracks. 7.24.6 prints each port apart from its address: `reply-dst-address=198.51.100.1 reply-dst-port=11344`. */
const CONNECTIONS = "/ip firewall connection print terse without-paging";

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

/** Runs one command on a CHR over SSH, without Circuit's start-up, so a short connection is still tracked when it is read. */
async function onChr(chr: string, command: string): Promise<string> {
    const [host, port] = chr.split(":");
    const client = await Ssh.connect({ host: host!, port: Number(port), user: "operator", password: () => password });
    try {
        return await Ssh.exec(client, command);
    } finally {
        client.end();
    }
}

/** Whether `check` holds within `WAIT_MS`, asking every `POLL_MS`. */
async function eventually(check: () => Promise<boolean>): Promise<boolean> {
    const deadline = Date.now() + WAIT_MS;
    while (!(await check())) {
        if (Date.now() > deadline) return false;
        await Bun.sleep(POLL_MS);
    }
    return true;
}

/** The address and port each of cpe-01's connections of `protocol` leaves as, as edge-01 tracks them. */
async function leavesAs(protocol: string): Promise<{ address: string; port?: number }[]> {
    const tracked = await onChr(edgeChr!, CONNECTIONS);
    console.log(`edge-01 tracks:\n${tracked}`);

    // An entry starts with its number, and may go on over more lines.
    const entries = tracked.split(/\n(?=\s*\d+\s)/).map((entry) => entry.replace(/\s+/g, " "));
    const field = (entry: string, name: string) => new RegExp(`(?:^| )${name}=(\\S+)`).exec(entry)?.[1] ?? "";

    return entries.flatMap((entry) => {
        if (field(entry, "protocol") !== protocol || field(entry, "src-address") !== CPE) return [];

        const port = field(entry, "reply-dst-port");
        return [{ address: field(entry, "reply-dst-address"), ...(port ? { port: Number(port) } : {}) }];
    });
}

/** Whether every one is cpe-01's pool address, in its block of ports, and there is one. */
function inBlock(found: readonly { address: string; port?: number }[]): boolean {
    return (
        found.length > 0 &&
        found.every(
            ({ address, port }) => address === CPE_POOL_ADDRESS && port !== undefined && port >= CPE_PORTS.min && port <= CPE_PORTS.max
        )
    );
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

describe.skipIf(!edgeChr || !cpeChr || !hostChr)("a CHR shares a pool among subscribers", () => {
    beforeAll(() => {
        write("circuit.ts", `export const lab = circuit({ sites: { lab: { description: "Three CHRs, linked port to port." } } });\n`);

        writeDevice(
            "edge-01",
            edgeChr!,
            `system: { users: { operator: { role: "admin", password: secret("OPERATOR_PASSWORD") } } },
    management: { allow: ["10.0.0.0/24"], ssh: {} },
    interfaces: {
        ethernet: {
            "virtual-1": { description: "Management", addresses: ["10.0.0.1/24"] },
            "virtual-2": { description: "cpe-01", addresses: ["${EDGE}/26"] },
            "virtual-3": { description: "host-01", addresses: ["${EDGE_UPLINK}/30"] },
        },
    },
    firewall: {
        interface_sets: { uplinks: ["virtual-3"] },
        nat: {
            source: [
                {
                    description: "CGNAT, 16 subscribers on each address",
                    if: { src: "${SUBSCRIBERS}", out_interface_set: "uplinks" },
                    then: "snat",
                    to_pool: "${POOL}",
                    port_set_size: ${PORT_SET_SIZE},
                },
            ],
        },
    },`
        );
        writeDevice(
            "cpe-01",
            cpeChr!,
            `management: { allow: ["10.0.1.0/24"], ssh: {} },
    interfaces: {
        ethernet: {
            "virtual-1": { description: "Management", addresses: ["10.0.1.1/24"] },
            "virtual-2": { description: "edge-01", addresses: ["${CPE}/26"] },
        },
    },
    routing: { static_routes: [{ prefix: "${HOST}/32", next_hop: "${EDGE}" }] },
    system: {
        users: { operator: { role: "admin", password: secret("OPERATOR_PASSWORD") } },
        ntp: { servers: ["${HOST}"] },
    },`
        );
        writeDevice(
            "host-01",
            hostChr!,
            `system: { users: { operator: { role: "admin", password: secret("OPERATOR_PASSWORD") } } },
    management: { allow: ["10.0.2.0/24"], ssh: {}, http: { allow: ["${POOL}"] } },
    interfaces: {
        ethernet: {
            "virtual-1": { description: "Management", addresses: ["10.0.2.1/24"] },
            "virtual-2": { description: "edge-01", addresses: ["${HOST}/30"] },
        },
    },
    routing: { static_routes: [{ prefix: "${POOL}", next_hop: "${EDGE_UPLINK}" }] },
    services: { ntp_server: true },`
        );
    });

    afterAll(() => rmSync(folder, { recursive: true, force: true }));

    test(
        "each router is set, and diff then finds nothing to change",
        () => {
            const planned = circuit("diff", "edge-01");
            expect(planned.output).toContain(
                `add action=src-nat chain=cgnat-${CPE_POOL_ADDRESS} protocol=tcp src-address=${CPE} to-addresses=${CPE_POOL_ADDRESS} to-ports=${CPE_PORTS.min}-${CPE_PORTS.max}`
            );

            // edge-01 before cpe-01: a flow tracked before the pool keeps its first translation until it ends, as cpe-01's NTP did.
            for (const device of ["host-01", "edge-01", "cpe-01"]) {
                expect(circuit("apply", device, "--confirm").status).toBe(0);
                expect(circuit("diff", device).status).toBe(0);
            }
        },
        TEST_MS
    );

    // host-01 routes the pool alone, so an answer reaches cpe-01 only when its traffic left as a pool address.
    test(
        "a TCP connection of cpe-01 leaves as its pool address, from its block of ports",
        async () => {
            const fetched = async () => {
                const answer = await onChr(cpeChr!, `/tool fetch url=http://${HOST}/ output=none`);
                console.log(`cpe-01 fetched http://${HOST}/: ${answer}`);
                return answer.includes("finished") && inBlock(await leavesAs("tcp"));
            };
            expect(await eventually(fetched)).toBe(true);
        },
        TEST_MS
    );

    test(
        "cpe-01's NTP over UDP leaves the same way",
        async () => {
            expect(await eventually(async () => inBlock(await leavesAs("udp")))).toBe(true);
        },
        TEST_MS
    );

    test(
        "a ping of cpe-01 leaves as its pool address",
        async () => {
            const answer = await onChr(cpeChr!, `/ping ${HOST} count=3`);
            console.log(`cpe-01 pinged ${HOST}:\n${answer}`);
            const pings = await leavesAs("icmp");

            expect(answer).toMatch(/received=[1-3]/);
            expect(pings.length).toBeGreaterThan(0);
            expect(pings.every(({ address }) => address === CPE_POOL_ADDRESS)).toBe(true);
        },
        TEST_MS
    );
});
