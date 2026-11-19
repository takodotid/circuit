// Two RouterOS CHRs, which the devices workflow boots, linked port to port, and FreeRADIUS on the runner. edge-01 is a PPPoE server whose subscribers RADIUS checks, and cpe-01 a subscriber's router that logs in through it. Skipped without the CHRs and FreeRADIUS.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/** Each CHR's SSH and REST API, as `host:port`. Each has the user `operator`, with the password in CIRCUIT_TEST_CHR_PASSWORD. */
const edgeChr = process.env.CIRCUIT_TEST_CHR;
const cpeChr = process.env.CIRCUIT_TEST_CHR_B;
const edgeRest = process.env.CHR_REST;
const cpeRest = process.env.CHR_B_REST;
/** Where the runner forwards UDP to edge-01's port for RADIUS requests (RFC 5176). */
const edgeCoa = process.env.CHR_COA;
const password = process.env.CIRCUIT_TEST_CHR_PASSWORD ?? "";
/** The key edge-01 and FreeRADIUS share, and the subscriber FreeRADIUS knows, as the workflow set them. */
const radiusSecret = process.env.CHR_RADIUS_SECRET;
const subscriber = process.env.CHR_SUBSCRIBER;
const subscriberPassword = process.env.CHR_SUBSCRIBER_PASSWORD;

const repo = join(import.meta.dir, "..", "..");
const folder = realpathSync(mkdtempSync(join(tmpdir(), "circuit-chr-pppoe-")));

/** A test applies to two routers, or waits for an interim report. */
const TEST_MS = 300_000;
/** How long a session or a report has to arrive. RouterOS reports every minute here. */
const WAIT_MS = 150_000;
const POLL_MS = 3000;

/** The runner, as edge-01 reaches it through QEMU's user network: the RADIUS server. */
const RADIUS = "10.0.0.2";
/** Where FreeRADIUS keeps each accounting request it gets. */
const ACCOUNTING = "/var/log/freeradius/radacct/*/detail-*";
/** An address from the pool, 100.64.0.2 to 100.64.63.254. */
const FROM_POOL = /address=(100\.64\.\d+\.\d+)\//;
/** The rate a change of authorization gives the session, each way, as RouterOS writes a queue's limit. */
const RATE = "10M/10M";

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

/** A script run on a CHR through its REST API, as a person would type it, with what it printed. */
async function typed(rest: string, script: string): Promise<string> {
    const response = await fetch(`http://${rest}/rest/execute`, {
        method: "POST",
        headers: { authorization: `Basic ${btoa(`operator:${password}`)}`, "content-type": "application/json" },
        body: JSON.stringify({ script, "as-string": "" }),
    });
    const answer = await response.text();
    console.log(`${rest} typed ${script.replace(/password=\S+/, "password=<redacted>")}: ${response.status} ${answer}`);
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

/** The subscriber's address, once its session is up. */
function sessionAddress(): string | undefined {
    const printed = circuit("exec", "cpe-01", "/ip address print terse where interface=pppoe-out").output;
    return FROM_POOL.exec(printed)?.[1];
}

const ready = Boolean(edgeChr && cpeChr && edgeRest && cpeRest && edgeCoa && radiusSecret && subscriber && subscriberPassword);

describe.skipIf(!ready)("a CHR serving PPPoE, checked by RADIUS", () => {
    beforeAll(() => {
        write("circuit.ts", `export const lab = circuit({ sites: { lab: { description: "Two CHRs, linked port to port." } } });\n`);

        writeDevice(
            "edge-01",
            edgeChr!,
            `management: { allow: ["10.0.0.0/24"], ssh: {}, http: {} },
    interfaces: {
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
                local_address: "100.64.0.1",
                pool: ["100.64.0.2", "100.64.63.254"],
                dns: ["192.0.2.53"],
                mtu: 1492,
                radius: [{ address: "${RADIUS}", secret_key: secret("RADIUS_SECRET") }],
                acct_interim_interval: 60,
                dynamic_authorization: true,
            },
        },
    },`
        );
        writeDevice(
            "cpe-01",
            cpeChr!,
            `management: { allow: ["10.0.1.0/24"], ssh: {}, http: {} },
    interfaces: {
        ethernet: {
            "virtual-1": { description: "Management", addresses: ["10.0.1.1/24"] },
            "virtual-2": { description: "edge-01" },
        },
    },`
        );
    });

    afterAll(() => rmSync(folder, { recursive: true, force: true }));

    test(
        "apply serves PPPoE, removes the PPP entries a person made by hand, and diff then finds nothing to change",
        async () => {
            for (const device of ["cpe-01", "edge-01"]) {
                expect(circuit("apply", device, "--confirm", "--secrets").status).toBe(0);
                expect(circuit("diff", device).status).toBe(0);
            }

            // What a router that served subscribers by hand holds. A server added without `disabled=no` is disabled.
            await typed(edgeRest!, "/ppp secret add name=stray password=stray-password service=pppoe");
            await typed(edgeRest!, "/ppp profile add name=stray-profile");
            await typed(edgeRest!, "/ppp profile set default only-one=yes rate-limit=10M/10M local-address=10.9.9.9");
            await typed(edgeRest!, "/interface pppoe-server server add interface=ether3 service-name=stray");
            await typed(edgeRest!, "/interface pppoe-server add name=pppoe-static service=as64500 user=stray");
            circuit("exec", "edge-01", "/interface pppoe-server server export verbose", "/ppp profile export");

            const planned = circuit("diff", "edge-01");
            expect(planned.status).toBe(1);
            for (const removed of [
                "name=stray service=pppoe",
                "name=stray-profile",
                "interface=ether3 service-name=stray",
                "name=pppoe-static",
                "only-one=default",
            ])
                expect(planned.output).toContain(removed);
            expect(circuit("apply", "edge-01", "--confirm").status).toBe(0);
            expect(circuit("diff", "edge-01").status).toBe(0);
        },
        TEST_MS
    );

    test(
        "a subscriber logs in through RADIUS, gets an address from the pool, and its use is reported every minute",
        async () => {
            await typed(
                cpeRest!,
                `/interface pppoe-client add interface=ether2 name=pppoe-out user=${subscriber} password=${subscriberPassword} add-default-route=no use-peer-dns=no disabled=no`
            );
            expect(eventually(() => sessionAddress() !== undefined)).toBe(true);
            circuit("exec", "edge-01", "/ppp active print detail", "/radius monitor 0 once");

            const accounting = () => shell(`sudo sh -c 'cat ${ACCOUNTING}'`);
            expect(eventually(() => /Acct-Status-Type = Interim-Update/.test(accounting()))).toBe(true);
            expect(accounting()).toContain(`User-Name = "${subscriber}"`);
        },
        TEST_MS
    );

    test(
        "the RADIUS server changes the session's rate, then ends the session, on port 3799",
        () => {
            const session = `User-Name = "${subscriber}"\\nFramed-IP-Address = ${sessionAddress()}`;
            const changed = shell(
                `printf '${session}\\nMikrotik-Rate-Limit = "${RATE}"\\n' | radclient -x -t 5 -r 2 ${edgeCoa} coa ${radiusSecret}`
            );
            expect(changed).toContain("Received CoA-ACK");
            expect(circuit("exec", "edge-01", "/queue simple print terse").output).toContain(`max-limit=${RATE}`);

            // A live session, and the queue it was given, change nothing the plan reads.
            expect(circuit("diff", "edge-01").status).toBe(0);

            const ended = shell(`printf '${session}\\n' | radclient -x -t 5 -r 2 ${edgeCoa} disconnect ${radiusSecret}`);
            expect(ended).toContain("Received Disconnect-ACK");
        },
        TEST_MS
    );

    test(
        "apply removes the subscriber's PPPoE client, which cpe-01's config does not hold",
        () => {
            expect(circuit("diff", "cpe-01").output).toContain("interface=ether2 name=pppoe-out");
            expect(circuit("apply", "cpe-01", "--confirm").status).toBe(0);
            expect(circuit("diff", "cpe-01").status).toBe(0);
        },
        TEST_MS
    );
});
