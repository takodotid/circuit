// Three RouterOS CHRs, which the devices workflow boots, the first linked to the others, and FreeRADIUS on the runner. edge-01 delegates prefixes by DHCPv6 to cpe-01 and host-01, asking RADIUS, which knows cpe-01 only. Then it is a PPPoE server whose sessions join an interface set its firewall matches, and cpe-01 logs in to it. Skipped without the CHRs and FreeRADIUS.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Address } from "../../src/core/address";

/** Each CHR's SSH, and the REST API of cpe-01 and host-01, as `host:port`. Each has the user `operator`, with the password in CIRCUIT_TEST_CHR_PASSWORD. */
const edgeChr = process.env.CIRCUIT_TEST_CHR;
const cpeChr = process.env.CIRCUIT_TEST_CHR_B;
const cpeRest = process.env.CHR_B_REST;
const hostRest = process.env.CHR_C_REST;
const password = process.env.CIRCUIT_TEST_CHR_PASSWORD ?? "";
/** The key edge-01 and FreeRADIUS share, the PPPoE subscriber FreeRADIUS knows, and cpe-01 as RouterOS's DHCPv6 server names it to RADIUS, as the workflow set them. */
const radiusSecret = process.env.CHR_RADIUS_SECRET;
const subscriber = process.env.CHR_SUBSCRIBER;
const subscriberPassword = process.env.CHR_SUBSCRIBER_PASSWORD;
const dhcpv6Subscriber = process.env.CHR_DHCPV6_SUBSCRIBER;

const repo = join(import.meta.dir, "..", "..");
const folder = realpathSync(mkdtempSync(join(tmpdir(), "circuit-chr-subscriber-")));

/** A test applies to two routers, and waits for a session or an interim report. */
const TEST_MS = 300_000;
/** How long a session, a prefix, or a report has to arrive. RouterOS reports every minute here. */
const WAIT_MS = 150_000;
const POLL_MS = 3000;

/** The runner, as edge-01 reaches it through QEMU's user network: the RADIUS server. */
const RADIUS = "10.0.0.2";
/** Where FreeRADIUS keeps each accounting request it gets. */
const ACCOUNTING = "/var/log/freeradius/radacct/*/detail-*";
/** Where edge-01 delegates prefixes from, toward cpe-01 and toward host-01. */
const DELEGATED_CPE = "2001:db8:100:8000::/50";
const DELEGATED_HOST = "2001:db8:100:c000::/50";
/** A prefix a DHCPv6 client holds, as RouterOS prints it. */
const HELD_PREFIX = /status=bound[\s\S]*prefix=(2001:db8:100:[\da-f:]+\/\d+)/;
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

/** edge-01: a DHCPv6 server toward each of cpe-01 and host-01, which delegates prefixes and asks RADIUS about each, or not. */
function writeEdgeDhcpv6(radius: boolean): void {
    const checked = radius ? `radius: [{ address: "${RADIUS}", secret_key: secret("RADIUS_SECRET") }], acct_interim_interval: 60,` : "";
    writeDevice(
        "edge-01",
        edgeChr!,
        "10.0.0.0/24",
        `interfaces: {
        ethernet: {
            "virtual-1": { description: "Management", addresses: ["10.0.0.1/24"] },
            "virtual-2": { description: "cpe-01" },
            "virtual-3": { description: "host-01" },
        },
    },
    services: {
        dhcpv6_server: {
            "homes-1": { interface: "virtual-2", prefix_delegation: { pool: "${DELEGATED_CPE}", prefix_length: 56 }, ${checked} },
            "homes-2": { interface: "virtual-3", prefix_delegation: { pool: "${DELEGATED_HOST}", prefix_length: 56 }, ${checked} },
        },
    },`
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

/** cpe-01, a subscriber's router, with its PPPoE client or none. */
function writeCpe(pppoe: boolean): void {
    const client = `
        pppoe_client: {
            internet: {
                interface: "virtual-2",
                description: "edge-01",
                user: "${subscriber}",
                password: secret("SUBSCRIBER_PASSWORD"),
                service_name: "as64500",
                mtu: 1492,
            },
        },`;
    writeDevice(
        "cpe-01",
        cpeChr!,
        "10.0.1.0/24",
        `interfaces: {
        ethernet: {
            "virtual-1": { description: "Management", addresses: ["10.0.1.1/24"] },
            "virtual-2": { description: "edge-01" },
        },${pppoe ? client : ""}
    },`
    );
}

/** The prefix a router's DHCPv6 client holds, read through its REST API, as host-01 is not in the project. */
async function heldPrefix(rest: string): Promise<string | undefined> {
    return HELD_PREFIX.exec(await typed(rest, "/ipv6 dhcp-client print detail"))?.[1];
}

/** Whether `check` holds within `WAIT_MS`, asking every `POLL_MS`. */
async function eventuallyAsync(check: () => Promise<boolean>): Promise<boolean> {
    const deadline = Date.now() + WAIT_MS;
    while (!(await check())) {
        if (Date.now() > deadline) return false;
        Bun.sleepSync(POLL_MS);
    }
    return true;
}

/** Whether FreeRADIUS has an interim report of cpe-01's prefix. */
function reported(): boolean {
    const records = shell(`sudo sh -c 'cat ${ACCOUNTING}'`).split(/\n\s*\n/);
    return records.some(
        (record) =>
            record.includes(`User-Name = "${dhcpv6Subscriber}"`) &&
            record.includes("Acct-Status-Type = Interim-Update") &&
            record.includes("Delegated-IPv6-Prefix")
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

const ready = Boolean(edgeChr && cpeChr && cpeRest && hostRest && radiusSecret && subscriber && subscriberPassword && dhcpv6Subscriber);

beforeAll(() => {
    write(
        "circuit.ts",
        `export const lab = circuit({ sites: { lab: { description: "Three CHRs, the first linked to the others." } } });\n`
    );
});

afterAll(() => rmSync(folder, { recursive: true, force: true }));

describe.skipIf(!ready)("a CHR delegating prefixes by DHCPv6, each checked by RADIUS", () => {
    beforeAll(() => {
        writeEdgeDhcpv6(true);
        writeCpe(false);
    });

    test(
        "apply serves DHCPv6 that asks RADIUS, and diff then finds nothing to change",
        () => {
            for (const device of ["edge-01", "cpe-01"]) {
                expect(circuit("apply", device, "--confirm", "--secrets").status).toBe(0);
                expect(circuit("diff", device).status).toBe(0);
            }
        },
        TEST_MS
    );

    test(
        "cpe-01, which RADIUS knows by the MAC address in its DUID, gets a prefix, host-01 gets none, and each prefix's use is reported every minute",
        async () => {
            // Each router asks for a prefix as a home router would. Neither is in the project, so Circuit leaves the clients alone.
            for (const rest of [cpeRest!, hostRest!])
                await typed(
                    rest,
                    ":if ([:len [/ipv6 dhcp-client find interface=ether2]] = 0) do={ /ipv6 dhcp-client add interface=ether2 request=prefix pool-name=delegated use-peer-dns=no }"
                );

            let prefix: string | undefined;
            expect(await eventuallyAsync(async () => (prefix = await heldPrefix(cpeRest!)) !== undefined)).toBe(true);
            expect(Address.contains(DELEGATED_CPE, prefix!)).toBe(true);
            circuit("exec", "edge-01", "/ipv6 dhcp-server binding print detail");

            const rejected = () => circuit("exec", "edge-01", '/log print where message~"PD: access rejected"').output;
            expect(eventually(() => rejected().includes("radius authentication failed"))).toBe(true);
            expect(await heldPrefix(hostRest!)).toBeUndefined();

            expect(eventually(reported)).toBe(true);
            expect(circuit("diff", "edge-01").status).toBe(0);
        },
        TEST_MS
    );

    test(
        "apply stops asking RADIUS once edge-01's config drops it, and host-01 then gets a prefix",
        async () => {
            writeEdgeDhcpv6(false);
            const planned = circuit("diff", "edge-01").output;
            for (const changed of ["use-radius=no", "interim-update=0s", "service=dhcp"]) expect(planned).toContain(changed);

            expect(circuit("apply", "edge-01", "--confirm").status).toBe(0);
            expect(circuit("diff", "edge-01").status).toBe(0);
            let prefix: string | undefined;
            expect(await eventuallyAsync(async () => (prefix = await heldPrefix(hostRest!)) !== undefined)).toBe(true);
            expect(Address.contains(DELEGATED_HOST, prefix!)).toBe(true);
            await typed(hostRest!, "/ipv6 dhcp-client remove [find interface=ether2]");
        },
        TEST_MS
    );
});

describe.skipIf(!ready)("subscribers of a CHR's PPPoE server", () => {
    beforeAll(() => {
        writeEdge({ interfaceSet: true });
        writeCpe(true);
    });

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
