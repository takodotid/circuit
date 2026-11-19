// Three RouterOS CHRs, which the devices workflow boots, the first linked to the other two. edge-01 holds both links in a VRF and runs its own services there. cpe-01 asks its SNMP and web interface over one link, and host-01 takes an address from its DHCP server over the other. Skipped without the three CHRs.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/** Each CHR's SSH, as `host:port`. Each has the user `operator`, with the password in CIRCUIT_TEST_CHR_PASSWORD. */
const edgeChr = process.env.CIRCUIT_TEST_CHR;
const cpeChr = process.env.CIRCUIT_TEST_CHR_B;
const hostChr = process.env.CIRCUIT_TEST_CHR_C;
/** cpe-01's REST API, as `host:port`, where the workflow left `admin` without a password. */
const cpeRest = process.env.CHR_B_REST;
const password = process.env.CIRCUIT_TEST_CHR_PASSWORD ?? "";

const repo = join(import.meta.dir, "..", "..");
const folder = realpathSync(mkdtempSync(join(tmpdir(), "circuit-chr-vrf-services-")));

/** A test applies to three routers, and waits for a lease. */
const TEST_MS = 300_000;

/** How long a lease has to arrive. */
const WAIT_MS = 60_000;

const POLL_MS = 3000;

const VRF = "services";
/** The SNMP community and the RADIUS key, only ever in this lab. */
const LAB_SECRET = "circuit-lab-secret";
/** edge-01's end of its link to cpe-01, in the VRF. */
const EDGE = "192.0.2.1";
/** cpe-01's end, in its main table: the time and name server, the syslog collector, and the RADIUS server edge-01 is told of. */
const CPE = "192.0.2.2";
/** The OID of `sysName` (RFC 3418). */
const SYS_NAME = "1.3.6.1.2.1.1.5.0";

/** Runs Circuit from the sources in the lab project, and prints what it printed, so the job's log shows each plan. */
function circuit(...args: string[]): { status: number | null; output: string } {
    const run = spawnSync("bun", [join(repo, "src", "cli", "index.ts"), ...args], {
        cwd: folder,
        encoding: "utf8",
        env: { ...process.env, OPERATOR_PASSWORD: password, LAB_SECRET },
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

describe.skipIf(!edgeChr || !cpeChr || !hostChr || !cpeRest)("a CHR's own services in a VRF", () => {
    beforeAll(() => {
        write("circuit.ts", `export const lab = circuit({ sites: { lab: { description: "Three CHRs, linked port to port." } } });\n`);

        writeDevice(
            "edge-01",
            edgeChr!,
            `system: {
        users: { operator: { role: "admin", password: secret("OPERATOR_PASSWORD") } },
        ntp: { servers: ["${CPE}"], vrf: "${VRF}" },
        dns: { servers: ["${CPE}"], vrf: "${VRF}" },
        aaa: { radius: [{ address: "${CPE}", secret_key: secret("LAB_SECRET"), vrf: "${VRF}" }], remote_role: "read-only" },
    },
    management: { allow: ["10.0.0.0/24"], ssh: {}, http: { allow: ["192.0.2.0/30"], vrf: "${VRF}" } },
    monitoring: {
        snmp: { allow: ["192.0.2.0/30"], community: secret("LAB_SECRET"), vrf: "${VRF}" },
        syslog: [{ address: "${CPE}", level: "warning", vrf: "${VRF}" }],
    },
    interfaces: {
        ethernet: {
            "virtual-1": { description: "Management", addresses: ["10.0.0.1/24"] },
            "virtual-2": { description: "cpe-01", addresses: ["${EDGE}/30"], vrf: "${VRF}" },
            "virtual-3": { description: "host-01", addresses: ["198.51.100.1/29"], vrf: "${VRF}" },
        },
    },
    services: {
        dhcp_server: {
            hosts: { interface: "virtual-3", network: "198.51.100.0/29", gateway: "198.51.100.1", pool: ["198.51.100.2", "198.51.100.6"] },
        },
    },
    routing: { vrfs: { "${VRF}": { description: "The router's own services" } } },`
        );
        writeDevice(
            "cpe-01",
            cpeChr!,
            `system: { users: { operator: { role: "admin", password: secret("OPERATOR_PASSWORD") } } },
    management: { allow: ["10.0.1.0/24"], ssh: {}, http: {} },
    interfaces: {
        ethernet: {
            "virtual-1": { description: "Management", addresses: ["10.0.1.1/24"] },
            "virtual-2": { description: "edge-01", addresses: ["${CPE}/30"] },
        },
    },
    services: { ntp_server: true, dns_server: true },`
        );
        writeDevice(
            "host-01",
            hostChr!,
            `system: { users: { operator: { role: "admin", password: secret("OPERATOR_PASSWORD") } } },
    management: { allow: ["10.0.2.0/24"], ssh: {} },
    interfaces: {
        ethernet: {
            "virtual-1": { description: "Management", addresses: ["10.0.2.1/24"] },
            "virtual-2": { description: "edge-01", dhcp_client: { default_routes: [] } },
        },
    },`
        );
    });

    afterAll(() => rmSync(folder, { recursive: true, force: true }));

    test(
        "each service is set to the VRF, and diff then finds nothing to change",
        () => {
            for (const device of ["cpe-01", "host-01", "edge-01"]) {
                circuit("diff", device);
                // The SNMP community is named by its secret, which an apply sends only with --secrets.
                expect(circuit("apply", device, "--confirm", "--secrets").status).toBe(0);
                expect(circuit("diff", device).status).toBe(0);
            }
            // What the router holds, for the job's log.
            circuit(
                "exec",
                "edge-01",
                "/system ntp client print",
                "/ip dns print",
                "/radius print",
                "/snmp print",
                "/ip service print detail where name=www"
            );
        },
        TEST_MS
    );

    test(
        "SNMP and the web interface answer in the VRF",
        async () => {
            const snmp = circuit("exec", "cpe-01", `/tool snmp-get address=${EDGE} community=${LAB_SECRET} version=2c oid=${SYS_NAME}`);

            const fetched = await fetch(`http://${cpeRest}/rest/tool/fetch`, {
                method: "POST",
                headers: { authorization: `Basic ${btoa(`operator:${password}`)}`, "content-type": "application/json" },
                body: JSON.stringify({ url: `http://${EDGE}/`, output: "user", "as-value": "" }),
            });
            const answer = await fetched.text();
            console.log(`cpe-01 fetched http://${EDGE}/: ${fetched.status} ${answer.slice(0, 300)}`);

            expect({ snmp: snmp.output.includes("edge-01"), web: answer.includes("finished") }).toEqual({ snmp: true, web: true });
        },
        TEST_MS
    );

    test(
        "the DHCP server in the VRF gives host-01 an address",
        () => {
            const leased = () =>
                circuit("exec", "host-01", "/ip address print where interface=ether2 and dynamic").output.includes("198.51.100.");
            expect(eventually(leased)).toBe(true);
        },
        TEST_MS
    );
});
