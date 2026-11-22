// Three RouterOS CHRs, which the devices workflow boots, the first linked to the other two, and FreeRADIUS on the runner. edge-01 relays host-01's DHCP requests to a server on cpe-01, which asks RADIUS about each lease. RADIUS knows host-01 by the circuit ID of edge-01's port only, so host-01 gets a lease once the relay adds Option 82. Skipped without the CHRs and FreeRADIUS.

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
/** The key the CHRs and FreeRADIUS share, and the circuit ID FreeRADIUS lets in, as the workflow set them. The circuit ID is the MAC address of edge-01's port toward host-01, as FreeRADIUS prints it. */
const radiusSecret = process.env.CHR_RADIUS_SECRET;
const circuitId = process.env.CHR_RELAY_CIRCUIT_ID;

const repo = join(import.meta.dir, "..", "..");
const folder = realpathSync(mkdtempSync(join(tmpdir(), "circuit-chr-dhcp-relay-")));

/** A test applies to three routers, or waits for a lease. */
const TEST_MS = 300_000;
/** How long a lease or a refusal has to arrive. */
const WAIT_MS = 150_000;
const POLL_MS = 3000;

/** The runner, as cpe-01 reaches it through QEMU's user network: the RADIUS server. */
const RADIUS = "10.0.1.2";
/** Where FreeRADIUS keeps each request it gets: the access requests, and the accounting requests. */
const REQUESTS = "/var/log/freeradius/radacct/*/*detail-*";
/** edge-01's address toward host-01: the relay's address in each request it forwards, and host-01's gateway. */
const RELAY = "100.64.65.1";
/** cpe-01's address toward edge-01, where its DHCP server takes relayed requests. */
const SERVER = "100.64.64.2";
/** Where edge-01 relays DHCPv6, an address of cpe-01's network that nothing answers. */
const SERVER_IPV6 = "2001:db8:100:64::2";
/** host-01's MAC address toward edge-01, as the workflow set it, which RouterOS's DHCP server sends RADIUS as `User-Name`. FreeRADIUS doesn't know it. */
const HOST_MAC = "52:54:00:00:0C:02";
/** A lease host-01 takes from cpe-01, behind the relay. */
const HOST_LEASE = /address=100\.64\.65\.\d+\/24/;

/** Runs Circuit from the sources in the lab project, and prints what it printed, so the job's log shows each plan. */
function circuit(...args: string[]): { status: number | null; output: string } {
    const run = spawnSync("bun", [join(repo, "src", "cli", "index.ts"), ...args], {
        cwd: folder,
        encoding: "utf8",
        env: { ...process.env, OPERATOR_PASSWORD: password, RADIUS_SECRET: radiusSecret },
    });
    const output = `${run.stdout}${run.stderr}`;
    console.log(`$ circuit ${args.join(" ")}\n${output}`);
    return { status: run.status, output };
}

/** A command on the runner, printed for the job's log. */
function shell(command: string): string {
    const run = spawnSync("sh", ["-c", command], { encoding: "utf8" });
    const output = `${run.stdout}${run.stderr}`;
    console.log(`$ ${command}\n${output}`);
    return output;
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

/** A device of the lab project on `chr`, managed on `management`, with these groups. */
function writeDevice(name: string, chr: string, management: string, groups: string): void {
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
    management: { allow: ["${management}"], ssh: {}, http: {} },
    ${groups}
});
`
    );
}

/** edge-01: the relay for host-01's network, toward cpe-01's server, which adds Option 82, or not. It relays DHCPv6 too, which no host asks for here. */
function writeEdge(option82: boolean): void {
    writeDevice(
        "edge-01",
        edgeChr!,
        "10.0.0.0/24",
        `interfaces: {
        ethernet: {
            "virtual-1": { description: "Management", addresses: ["10.0.0.1/24"] },
            "virtual-2": { description: "cpe-01", addresses: ["100.64.64.1/24", "2001:db8:100:64::1/64"] },
            "virtual-3": { description: "host-01", addresses: ["${RELAY}/24"] },
        },
    },
    services: {
        dhcp_relay: {
            "homes-2": { interface: "virtual-3", servers: ["${SERVER}", "${SERVER_IPV6}"], ${option82 ? "relay_agent_information: true" : ""} },
        },
    },`
    );
}

/** cpe-01: a DHCP server for host-01's network, which asks RADIUS about each lease, for the clients behind edge-01's relay, or for its own port's. */
function writeCpe(relayed: boolean): void {
    writeDevice(
        "cpe-01",
        cpeChr!,
        "10.0.1.0/24",
        `interfaces: {
        ethernet: {
            "virtual-1": { description: "Management", addresses: ["10.0.1.1/24"] },
            "virtual-2": { description: "edge-01", addresses: ["${SERVER}/24"] },
        },
    },
    routing: { static_routes: [{ prefix: "100.64.65.0/24", next_hop: "100.64.64.1", description: "edge-01" }] },
    services: {
        dhcp_server: {
            "homes-2": {
                interface: "virtual-2",
                ${relayed ? `relay: "${RELAY}",` : ""}
                network: "100.64.65.0/24",
                gateway: "${RELAY}",
                pool: ["100.64.65.10", "100.64.65.20"],
                radius: [{ address: "${RADIUS}", secret_key: secret("RADIUS_SECRET") }],
            },
        },
    },`
    );
}

/** host-01: its management port, and its port toward edge-01, which takes its address by DHCP and no default route. */
function writeHost(): void {
    writeDevice(
        "host-01",
        hostChr!,
        "10.0.2.0/24",
        `interfaces: {
        ethernet: {
            "virtual-1": { description: "Management", addresses: ["10.0.2.1/24"] },
            "virtual-2": { description: "edge-01", dhcp_client: { default_routes: [] } },
        },
    },`
    );
}

/** What host-01's DHCP client holds. */
function lease(): string {
    return circuit("exec", "host-01", "/ip dhcp-client print detail").output;
}

/** What FreeRADIUS got from cpe-01, each request a record. */
function requests(): string[] {
    return shell(`sudo sh -c 'cat ${REQUESTS}'`).split(/\n\s*\n/);
}

const ready = Boolean(edgeChr && cpeChr && hostChr && radiusSecret && circuitId);

describe.skipIf(!ready)("a CHR relaying DHCP with Option 82 to a server that asks RADIUS", () => {
    beforeAll(() => {
        write(
            "circuit.ts",
            `export const lab = circuit({ sites: { lab: { description: "Three CHRs, the first linked to the others." } } });\n`
        );
        writeEdge(false);
        writeCpe(true);
        writeHost();
    });

    afterAll(() => rmSync(folder, { recursive: true, force: true }));

    test(
        "apply relays DHCP to a server for the relay's clients, and diff then finds nothing to change",
        () => {
            for (const device of ["edge-01", "cpe-01", "host-01"]) {
                expect(circuit("apply", device, "--confirm", "--secrets").status).toBe(0);
                expect(circuit("diff", device).status).toBe(0);
            }
            circuit("exec", "edge-01", "/ip dhcp-relay export verbose");
            circuit("exec", "edge-01", "/ipv6 dhcp-relay export verbose");
            circuit("exec", "cpe-01", "/ip dhcp-server export verbose");
        },
        TEST_MS
    );

    test(
        "without Option 82, the server asks RADIUS about host-01's relayed request, which RADIUS refuses",
        () => {
            // host-01 may hold a lease from an earlier test: it gives it up and asks again.
            circuit("exec", "host-01", "/ip dhcp-client release [find]");

            // The log is read by topic, so the command printed above it doesn't hold the words looked for.
            const refused = () => circuit("exec", "cpe-01", '/log print where topics~"dhcp"').output;
            expect(eventually(() => refused().includes("radius authentication failed"))).toBe(true);
            expect(lease()).not.toContain("status=bound");
            const asked = requests().filter((record) => record.includes(`User-Name = "${HOST_MAC}"`));
            expect(asked.length).toBeGreaterThan(0);
            expect(asked.some((record) => record.includes("Agent-Circuit-Id"))).toBe(false);
        },
        TEST_MS
    );

    test(
        "with Option 82, RADIUS lets host-01 in by the circuit ID of edge-01's port, and host-01 takes a lease",
        () => {
            writeEdge(true);
            expect(circuit("diff", "edge-01").output).toContain("add-relay-info=yes");
            expect(circuit("apply", "edge-01", "--confirm").status).toBe(0);
            expect(circuit("diff", "edge-01").status).toBe(0);

            const leased = eventually(() => HOST_LEASE.test(lease()));
            circuit("exec", "cpe-01", '/log print where topics~"dhcp"');
            circuit("exec", "edge-01", '/log print where topics~"dhcp"');
            circuit("exec", "cpe-01", "/ip dhcp-server lease print detail");
            const accepted = requests();
            expect(leased).toBe(true);
            // RFC 4679's attribute, and the same circuit ID as vendor 2352's.
            expect(accepted.some((record) => record.includes(`ADSL-Agent-Circuit-Id = ${circuitId}`))).toBe(true);

            // The lease changes nothing the plan reads.
            for (const device of ["edge-01", "cpe-01", "host-01"]) expect(circuit("diff", device).status).toBe(0);
        },
        TEST_MS
    );

    test(
        "apply removes Option 82 from the relay, and the relay's address from the server",
        () => {
            writeEdge(false);
            writeCpe(false);
            expect(circuit("diff", "edge-01").output).toContain("add-relay-info=no");
            expect(circuit("diff", "cpe-01").output).toContain("relay=0.0.0.0");

            for (const device of ["edge-01", "cpe-01"]) {
                expect(circuit("apply", device, "--confirm").status).toBe(0);
                expect(circuit("diff", device).status).toBe(0);
            }
        },
        TEST_MS
    );
});
