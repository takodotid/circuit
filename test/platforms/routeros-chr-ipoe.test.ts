// Three RouterOS CHRs, which the devices workflow boots, the first linked to the other two, and FreeRADIUS on the runner. edge-01 serves DHCP to cpe-01 and host-01, and asks RADIUS about each lease (IPoE). RADIUS knows cpe-01's MAC and not host-01's. Skipped without the CHRs and FreeRADIUS.

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
/** The key edge-01 and FreeRADIUS share, and cpe-01's MAC on its link to edge-01, which FreeRADIUS lets in, as the workflow set them. */
const radiusSecret = process.env.CHR_RADIUS_SECRET;
const cpeMac = process.env.CHR_IPOE_SUBSCRIBER;

const repo = join(import.meta.dir, "..", "..");
const folder = realpathSync(mkdtempSync(join(tmpdir(), "circuit-chr-ipoe-")));

/** A test applies to three routers, or waits for an interim report. */
const TEST_MS = 300_000;
/** How long a lease or a report has to arrive. RouterOS reports every minute here. */
const WAIT_MS = 150_000;
const POLL_MS = 3000;

/** The runner, as edge-01 reaches it through QEMU's user network: the RADIUS server. */
const RADIUS = "10.0.0.2";
/** Where FreeRADIUS keeps each accounting request it gets. */
const ACCOUNTING = "/var/log/freeradius/radacct/*/detail-*";
/** A lease each client takes: cpe-01's from 100.64.64.0/24, and host-01's from 100.64.65.0/24. */
const CPE_LEASE = /address=100\.64\.64\.\d+\/24/;
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

/** A client of edge-01: its management port, and its port toward edge-01, which takes its address by DHCP and no default route. */
function writeClient(name: string, chr: string, management: string): void {
    writeDevice(
        name,
        chr,
        management,
        `interfaces: {
        ethernet: {
            "virtual-1": { description: "Management", addresses: ["${management.replace(".0/24", ".1/24")}"] },
            "virtual-2": { description: "edge-01", dhcp_client: { default_routes: [] } },
        },
    },`
    );
}

/** edge-01, with a DHCP server toward each client, which asks RADIUS about each lease, or not. */
function writeEdge(radius: boolean): void {
    const checked = radius ? `radius: [{ address: "${RADIUS}", secret_key: secret("RADIUS_SECRET") }], acct_interim_interval: 60,` : "";
    writeDevice(
        "edge-01",
        edgeChr!,
        "10.0.0.0/24",
        `interfaces: {
        ethernet: {
            "virtual-1": { description: "Management", addresses: ["10.0.0.1/24"] },
            "virtual-2": { description: "cpe-01", addresses: ["100.64.64.1/24"] },
            "virtual-3": { description: "host-01", addresses: ["100.64.65.1/24"] },
        },
    },
    services: {
        dhcp_server: {
            "homes-1": {
                interface: "virtual-2",
                network: "100.64.64.0/24",
                gateway: "100.64.64.1",
                pool: ["100.64.64.10", "100.64.64.20"],
                ${checked}
            },
            "homes-2": {
                interface: "virtual-3",
                network: "100.64.65.0/24",
                gateway: "100.64.65.1",
                pool: ["100.64.65.10", "100.64.65.20"],
                ${checked}
            },
        },
    },`
    );
}

/** What a client's DHCP client holds. */
function lease(device: string): string {
    return circuit("exec", device, "/ip dhcp-client print detail").output;
}

/** Whether FreeRADIUS has an interim report of cpe-01's lease. */
function reported(): boolean {
    const records = shell(`sudo sh -c 'cat ${ACCOUNTING}'`).split(/\n\s*\n/);
    return records.some((record) => record.includes(`User-Name = "${cpeMac}"`) && record.includes("Acct-Status-Type = Interim-Update"));
}

const ready = Boolean(edgeChr && cpeChr && hostChr && radiusSecret && cpeMac);

describe.skipIf(!ready)("a CHR serving DHCP, each lease checked by RADIUS", () => {
    beforeAll(() => {
        write(
            "circuit.ts",
            `export const lab = circuit({ sites: { lab: { description: "Three CHRs, the first linked to the others." } } });\n`
        );
        writeEdge(true);
        writeClient("cpe-01", cpeChr!, "10.0.1.0/24");
        writeClient("host-01", hostChr!, "10.0.2.0/24");
    });

    afterAll(() => rmSync(folder, { recursive: true, force: true }));

    test(
        "apply serves DHCP that asks RADIUS, and diff then finds nothing to change",
        () => {
            for (const device of ["edge-01", "cpe-01", "host-01"]) {
                expect(circuit("apply", device, "--confirm", "--secrets").status).toBe(0);
                expect(circuit("diff", device).status).toBe(0);
            }
        },
        TEST_MS
    );

    test(
        "cpe-01, which RADIUS knows by its MAC, gets a lease, host-01 gets none, and each lease's use is reported every minute",
        () => {
            expect(eventually(() => CPE_LEASE.test(lease("cpe-01")))).toBe(true);
            circuit("exec", "edge-01", "/ip dhcp-server lease print detail", "/radius monitor 0 once");

            // RADIUS refused host-01 while cpe-01 took its lease.
            expect(lease("host-01")).not.toMatch(HOST_LEASE);
            expect(circuit("exec", "edge-01", "/log print").output).toContain("access rejected");

            expect(eventually(reported)).toBe(true);

            // The leases change nothing the plan reads.
            for (const device of ["edge-01", "cpe-01", "host-01"]) expect(circuit("diff", device).status).toBe(0);
        },
        TEST_MS
    );

    test(
        "apply stops asking RADIUS once edge-01's config drops it, and host-01 then gets a lease",
        () => {
            writeEdge(false);
            const planned = circuit("diff", "edge-01").output;
            for (const changed of ["use-radius=no", "interim-update=0s", "service=dhcp"]) expect(planned).toContain(changed);

            expect(circuit("apply", "edge-01", "--confirm").status).toBe(0);
            expect(circuit("diff", "edge-01").status).toBe(0);
            expect(eventually(() => HOST_LEASE.test(lease("host-01")))).toBe(true);
        },
        TEST_MS
    );
});
