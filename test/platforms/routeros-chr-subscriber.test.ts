// Two RouterOS CHRs, which the devices workflow boots, linked port to port, and FreeRADIUS on the runner. edge-01 is a PPPoE server whose sessions join an interface set that its firewall matches. cpe-01 is a subscriber's router that logs in to it. Skipped without the CHRs and FreeRADIUS.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/** Each CHR's SSH, and cpe-01's REST API, as `host:port`. Each has the user `operator`, with the password in CIRCUIT_TEST_CHR_PASSWORD. */
const edgeChr = process.env.CIRCUIT_TEST_CHR;
const cpeChr = process.env.CIRCUIT_TEST_CHR_B;
const cpeRest = process.env.CHR_B_REST;
const password = process.env.CIRCUIT_TEST_CHR_PASSWORD ?? "";
/** The key edge-01 and FreeRADIUS share, and the subscriber FreeRADIUS knows, as the workflow set them. */
const radiusSecret = process.env.CHR_RADIUS_SECRET;
const subscriber = process.env.CHR_SUBSCRIBER;
const subscriberPassword = process.env.CHR_SUBSCRIBER_PASSWORD;

const repo = join(import.meta.dir, "..", "..");
const folder = realpathSync(mkdtempSync(join(tmpdir(), "circuit-chr-subscriber-")));

/** A test applies to two routers, and waits for sessions to come back. */
const TEST_MS = 300_000;
/** How long a session has to come up. */
const WAIT_MS = 120_000;
const POLL_MS = 3000;

/** The runner, as edge-01 reaches it through QEMU's user network: the RADIUS server. */
const RADIUS = "10.0.0.2";
/** edge-01's own address in every session. */
const EDGE = "100.64.0.1";
/** An address from the pool, 100.64.0.2 to 100.64.63.254. */
const FROM_POOL = /address=(100\.64\.\d+\.\d+)\//;

/** Runs Circuit from the sources in the lab project, and prints what it printed, so the job's log shows each plan. */
function circuit(...args: string[]): { status: number | null; output: string } {
    const run = spawnSync("bun", [join(repo, "src", "cli", "index.ts"), ...args], {
        cwd: folder,
        encoding: "utf8",
        env: { ...process.env, OPERATOR_PASSWORD: password, RADIUS_SECRET: radiusSecret, SUBSCRIBER_PASSWORD: subscriberPassword },
    });
    const output = `${run.stdout}${run.stderr}`;
    console.log(`$ circuit ${args.join(" ")}\n${output}`);
    return { status: run.status, output };
}

/** A script run on a CHR through its REST API, as a person would type it, with what it printed. */
async function typed(rest: string, script: string): Promise<string> {
    const response = await fetch(`http://${rest}/rest/execute`, {
        method: "POST",
        headers: { authorization: `Basic ${btoa(`operator:${password}`)}`, "content-type": "application/json" },
        body: JSON.stringify({ script, "as-string": "" }),
    });
    const answer = await response.text();
    console.log(`${rest} typed ${script}: ${response.status} ${answer}`);
    expect(response.ok).toBe(true);
    return answer;
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

/** What edge-01's PPPoE server has besides its pool and RADIUS. */
type Server = { interfaceSet?: boolean };

/** edge-01: a PPPoE server for cpe-01. With `interfaceSet`, each session joins `subscribers`, from which the firewall drops pings to the router. */
function writeEdge(server: Server): void {
    const set = server.interfaceSet ? `interface_set: "subscribers",` : "";
    writeDevice(
        "edge-01",
        edgeChr!,
        "10.0.0.0/24",
        `interfaces: {
        ethernet: {
            "virtual-1": { description: "Management", addresses: ["10.0.0.1/24"] },
            "virtual-2": { description: "Subscribers" },
        },
    },
    services: {
        pppoe_server: {
            "olt-1": {
                interfaces: ["virtual-2"],
                service_name: "as64500",
                local_address: "${EDGE}",
                pool: ["100.64.0.2", "100.64.63.254"],
                mtu: 1492,
                radius: [{ address: "${RADIUS}", secret_key: secret("RADIUS_SECRET") }],
                ${set}
            },
        },
    },
    firewall: {
        interface_sets: { subscribers: [] },
        filter: {
            input: {
                rules: [
                    { description: "No ping from subscribers", if: { family: "ipv4", in_interface_set: "subscribers", protocol: "icmp" }, then: "drop" },
                ],
            },
        },
    },`
    );
}

/** cpe-01, a subscriber's router, with its PPPoE client. */
function writeCpe(): void {
    writeDevice(
        "cpe-01",
        cpeChr!,
        "10.0.1.0/24",
        `interfaces: {
        ethernet: {
            "virtual-1": { description: "Management", addresses: ["10.0.1.1/24"] },
            "virtual-2": { description: "edge-01" },
        },
        pppoe_client: {
            internet: {
                interface: "virtual-2",
                description: "edge-01",
                user: "${subscriber}",
                password: secret("SUBSCRIBER_PASSWORD"),
                service_name: "as64500",
                mtu: 1492,
            },
        },
    },`
    );
}

/** cpe-01's address in its session, once the session is up. */
function sessionAddress(): string | undefined {
    const printed = circuit("exec", "cpe-01", "/ip address print terse where interface=internet").output;
    return FROM_POOL.exec(printed)?.[1];
}

/** Takes cpe-01's session down and up again, as a subscriber's router does after a power cut, and waits for it. */
async function redial(): Promise<void> {
    await typed(cpeRest!, "/interface pppoe-client disable internet; :delay 2s; /interface pppoe-client enable internet");
    expect(eventually(() => sessionAddress() !== undefined)).toBe(true);
}

/** Whether cpe-01 reaches edge-01 through the session. */
function pings(): boolean {
    return circuit("exec", "cpe-01", `/ping ${EDGE} count=3`).output.includes("received=3");
}

const ready = Boolean(edgeChr && cpeChr && cpeRest && radiusSecret && subscriber && subscriberPassword);

describe.skipIf(!ready)("subscribers of a CHR's PPPoE server", () => {
    beforeAll(() => {
        write("circuit.ts", `export const lab = circuit({ sites: { lab: { description: "Two CHRs, linked port to port." } } });\n`);
        writeEdge({ interfaceSet: true });
        writeCpe();
    });

    afterAll(() => rmSync(folder, { recursive: true, force: true }));

    test(
        "apply serves PPPoE whose sessions join an interface set, and dials it from cpe-01, and diff then finds nothing to change",
        async () => {
            for (const device of ["edge-01", "cpe-01"]) {
                expect(circuit("apply", device, "--confirm", "--secrets").status).toBe(0);
                expect(circuit("diff", device).status).toBe(0);
            }
            await redial();
        },
        TEST_MS
    );

    test(
        "the session joins the set while it is up, so the firewall drops its pings, and a session that joins no set is let through",
        async () => {
            const members = circuit("exec", "edge-01", "/interface list member print detail where list=subscribers").output;
            expect(members).toContain("interface=<pppoe-");
            expect(pings()).toBe(false);
            for (const device of ["edge-01", "cpe-01"]) expect(circuit("diff", device).status).toBe(0);

            writeEdge({});
            expect(circuit("diff", "edge-01").output).toContain("interface-list");
            expect(circuit("apply", "edge-01", "--confirm").status).toBe(0);
            expect(circuit("diff", "edge-01").status).toBe(0);
            await redial();
            expect(circuit("exec", "edge-01", "/interface list member print count-only where dynamic").output).toMatch(/^0$/m);
            expect(pings()).toBe(true);

            // Joined again, the next session is dropped again.
            writeEdge({ interfaceSet: true });
            expect(circuit("apply", "edge-01", "--confirm").status).toBe(0);
            expect(circuit("diff", "edge-01").status).toBe(0);
            await redial();
            expect(pings()).toBe(false);
        },
        TEST_MS
    );
});
