// Two RouterOS CHRs, which the devices workflow boots, linked port to port, and FreeRADIUS on the runner. edge-01 is a PPPoE server whose subscribers RADIUS checks, and which delegates IPv6 prefixes. cpe-01 logs in through it, asks for a prefix, and gives a /64 of it to its hosts. Then it takes one RADIUS sends, then one it asks for with a prefix hint. Skipped without the CHRs and FreeRADIUS.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Address } from "../../src/core/address";

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
/** A second subscriber, whose accept carries an IPv6 prefix (Delegated-IPv6-Prefix, RFC 4818), outside `DELEGATED`. */
const prefixSubscriber = process.env.CHR_PREFIX_SUBSCRIBER;
const radiusPrefix = process.env.CHR_RADIUS_PREFIX;

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
/** Where edge-01 delegates each subscriber a /56 from. */
const DELEGATED = "2001:db8:100:8000::/49";
/** edge-01's own IPv6 address, on its loopback, which reaches a subscriber's hosts. */
const EDGE_IPV6 = "2001:db8:100::1";
/** cpe-01's address in the /64 its hosts take from the delegated prefix. */
const FROM_PREFIX = /address=(2001:db8:100:[\da-f:]+)\/64/;
/** The rate a change of authorization gives the session, each way, as RouterOS writes a queue's limit. */
const RATE = "10M/10M";
/** The prefix length cpe-01 asks for, a /60, though RADIUS sends a /56. */
const HINT = 60;
/** Two /56s of `DELEGATED` that cpe-01 asks for by a prefix hint, one after the other. The pool gives 2001:db8:100:8000::/56 first. */
const HINTED = "2001:db8:100:a500::/56";
const HINTED_NEXT = "2001:db8:100:b600::/56";
/** The prefix a DHCPv6 client holds, as RouterOS prints it. */
const HELD_PREFIX = /status=bound[\s\S]*?prefix=(2001:db8:[\da-f:]+\/\d+)/;

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
    const printed = circuit("exec", "cpe-01", "/ip address print terse where interface=internet").output;
    return FROM_POOL.exec(printed)?.[1];
}

/** cpe-01's address on its hosts' interface, once its session holds a delegated prefix. */
function hostsAddress(): string | undefined {
    const printed = circuit("exec", "cpe-01", "/ipv6 address print terse where interface=hosts").output;
    return FROM_PREFIX.exec(printed)?.[1];
}

/** The prefix cpe-01's DHCPv6 client holds, once it is bound. */
function held(): string | undefined {
    return HELD_PREFIX.exec(circuit("exec", "cpe-01", "/ipv6 dhcp-client print detail").output)?.[1];
}

/** Whether edge-01 reaches `hosts` from its loopback, within `WAIT_MS`. A new address takes no packets until duplicate address detection ends, about 1.5 s later on a CHR (RFC 4862, TRAPS.md). So one ping is sent until one answers. */
function answers(hosts: string): boolean {
    return eventually(() => circuit("exec", "edge-01", `/ping ${hosts} src-address=${EDGE_IPV6} count=1`).output.includes("received=1"));
}

/** cpe-01, a subscriber's router: its PPPoE client and what goes through it, logged in as `user`. Given a `hint`, it asks for a prefix of that many bits, or for that prefix. */
function writeCpe(pppoe: boolean, user = subscriber, hint?: number | string): void {
    const request = typeof hint === "string" ? `prefix: "${hint}", ` : hint ? `prefix_length: ${hint}, ` : "";
    const client = `
        loopback: { hosts: { description: "Where the subscriber's hosts would be" } },
        pppoe_client: {
            "internet": {
                interface: "virtual-2",
                description: "edge-01",
                user: "${user}",
                password: secret("SUBSCRIBER_PASSWORD"),
                service_name: "as64500",
                mtu: 1492,
                prefix_delegation: { ${request}interfaces: { hosts: "::1" } },
            },
        },`;
    const routes = `
    routing: {
        static_routes: [
            { prefix: "0.0.0.0/0", interface: "internet" },
            { prefix: "::/0", interface: "internet" },
        ],
    },`;
    writeDevice(
        "cpe-01",
        cpeChr!,
        `management: { allow: ["10.0.1.0/24"], ssh: {}, http: {} },
    interfaces: {
        ethernet: {
            "virtual-1": { description: "Management", addresses: ["10.0.1.1/24"] },
            "virtual-2": { description: "edge-01" },
        },${pppoe ? client : ""}
    },${pppoe ? routes : ""}`
    );
}

const ready = Boolean(
    edgeChr &&
    cpeChr &&
    edgeRest &&
    cpeRest &&
    edgeCoa &&
    radiusSecret &&
    subscriber &&
    subscriberPassword &&
    prefixSubscriber &&
    radiusPrefix
);

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
        loopback: { loopback: { addresses: ["${EDGE_IPV6}/128"] } },
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
                prefix_delegation: { pool: "${DELEGATED}", prefix_length: 56 },
            },
        },
    },`
        );
        writeCpe(true);
    });

    afterAll(() => rmSync(folder, { recursive: true, force: true }));

    test(
        "apply serves PPPoE, dials it from cpe-01, removes the PPP entries a person made by hand, and diff then finds nothing to change",
        async () => {
            for (const device of ["edge-01", "cpe-01"]) {
                expect(circuit("apply", device, "--confirm", "--secrets").status).toBe(0);
                expect(circuit("diff", device).status).toBe(0);
            }

            // What a router that served subscribers by hand holds. A server added without `disabled=no` is disabled.
            await typed(edgeRest!, "/ppp secret add name=stray password=stray-password service=pppoe");
            await typed(edgeRest!, "/ppp profile add name=stray-profile");
            await typed(
                edgeRest!,
                "/ppp profile set default only-one=yes rate-limit=10M/10M local-address=10.9.9.9 dhcpv6-pd-pool=olt-1-pd remote-ipv6-prefix-pool=olt-1-pd"
            );
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
                "dhcpv6-pd-pool=",
                "remote-ipv6-prefix-pool=",
            ])
                expect(planned.output).toContain(removed);
            expect(circuit("apply", "edge-01", "--confirm").status).toBe(0);
            expect(circuit("diff", "edge-01").status).toBe(0);
        },
        TEST_MS
    );

    test(
        "cpe-01 logs in through RADIUS, gets an address from the pool and a prefix from the delegated pool, and its use is reported every minute",
        async () => {
            expect(eventually(() => sessionAddress() !== undefined)).toBe(true);
            let hosts: string | undefined;
            expect(eventually(() => (hosts = hostsAddress()) !== undefined)).toBe(true);
            circuit("exec", "edge-01", "/ppp active print detail", "/radius monitor 0 once", "/ipv6 dhcp-server binding print detail");
            circuit(
                "exec",
                "cpe-01",
                "/interface pppoe-client monitor internet once",
                "/ipv6 dhcp-client print detail",
                "/ipv6 address export"
            );

            // The /64 is in a prefix from edge-01's pool, and each router reaches the other's address through the session.
            expect(Address.contains(DELEGATED, hosts!)).toBe(true);
            expect(circuit("exec", "cpe-01", "/ping 100.64.0.1 count=3").output).toContain("received=3");
            expect(answers(hosts!)).toBe(true);
            expect(circuit("exec", "edge-01", `/ping ${hosts} src-address=${EDGE_IPV6} count=3`).output).toContain("received=3");

            // The session's address, its prefix, and the /64 each interface took change nothing the plan reads.
            expect(circuit("diff", "cpe-01").status).toBe(0);
            expect(circuit("diff", "edge-01").status).toBe(0);

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
        "apply removes the PPPoE client, its DHCPv6 client, and the address from its prefix, once cpe-01's config drops them",
        () => {
            writeCpe(false);
            const planned = circuit("diff", "cpe-01").output;
            for (const removed of ["name=internet", "interface=internet", "from-pool=internet"]) expect(planned).toContain(removed);

            expect(circuit("apply", "cpe-01", "--confirm").status).toBe(0);
            expect(circuit("diff", "cpe-01").status).toBe(0);
            const left = circuit("exec", "cpe-01", "/interface pppoe-client print count-only", "/ipv6 dhcp-client print count-only").output;
            expect(left.match(/^0$/gm)?.length).toBe(2);
        },
        TEST_MS
    );

    test(
        "a subscriber RADIUS sends a prefix for gets it in place of one from the pool, and cpe-01's client asks for a /60 and takes the /56",
        async () => {
            // edge-01 logs each DHCPv6 packet, to show the length cpe-01 asks for. The rule is a person's, and is gone before the plans below.
            await typed(edgeRest!, "/system logging add topics=dhcp,debug");
            writeCpe(true, prefixSubscriber, HINT);
            expect(circuit("apply", "cpe-01", "--confirm", "--secrets").status).toBe(0);

            let hosts: string | undefined;
            expect(eventually(() => (hosts = hostsAddress()) !== undefined)).toBe(true);
            circuit("exec", "edge-01", "/ipv6 dhcp-server binding print detail", "/ipv6 pool used print");
            circuit("exec", "cpe-01", "/ipv6 dhcp-client print detail");
            expect(Address.contains(radiusPrefix!, hosts!)).toBe(true);
            expect(Address.contains(DELEGATED, hosts!)).toBe(false);
            expect(answers(hosts!)).toBe(true);
            expect(circuit("exec", "edge-01", `/ping ${hosts} src-address=${EDGE_IPV6} count=3`).output).toContain("received=3");

            // The Solicit carries the hint as an IA Prefix of ::/60 (RFC 8168).
            expect(circuit("exec", "edge-01", "/log print").output).toContain(`prefix: ::/${HINT}`);
            // A list matches only quoted, with `;` between its items (TRAPS.md).
            await typed(edgeRest!, '/system logging remove [find topics="dhcp;debug"]');

            expect(circuit("diff", "cpe-01").status).toBe(0);
            expect(circuit("diff", "edge-01").status).toBe(0);

            // RADIUS hears of the prefix in the session's accounting.
            const accounting = shell(`sudo sh -c 'cat ${ACCOUNTING}'`);
            expect(accounting).toContain(`Delegated-IPv6-Prefix = ${radiusPrefix}`);
        },
        TEST_MS
    );

    test(
        "cpe-01's client asks for a whole /56 of the pool with a prefix hint, and edge-01 gives it, though the pool gives another first",
        async () => {
            // A new client, which asks with a Solicit, the only message that carries a hint: one that holds a prefix asks for that one (TRAPS.md).
            writeCpe(false);
            expect(circuit("apply", "cpe-01", "--confirm").status).toBe(0);
            await typed(edgeRest!, "/system logging add topics=dhcp,debug");
            writeCpe(true, subscriber, HINTED);
            expect(circuit("apply", "cpe-01", "--confirm", "--secrets").status).toBe(0);

            let hosts: string | undefined;
            expect(eventually(() => (hosts = hostsAddress()) !== undefined)).toBe(true);
            circuit("exec", "edge-01", "/ipv6 dhcp-server binding print detail", "/ipv6 pool used print");
            expect(held()).toBe(HINTED);
            expect(Address.contains(HINTED, hosts!)).toBe(true);
            expect(answers(hosts!)).toBe(true);

            // The Solicit carries the whole prefix in its IA Prefix option (RFC 9915 §18.2.1), and the export prints it as written.
            expect(circuit("exec", "edge-01", "/log print").output).toContain(`prefix: ${HINTED}`);
            expect(circuit("exec", "cpe-01", "/ipv6 dhcp-client export").output).toContain(`prefix-hint=${HINTED}`);
            expect(circuit("diff", "cpe-01").status).toBe(0);
        },
        TEST_MS
    );

    test(
        "a changed hint waits for a Solicit: cpe-01 keeps its prefix until its DHCPv6 client is off while the session comes back",
        async () => {
            writeCpe(true, subscriber, HINTED_NEXT);
            expect(circuit("diff", "cpe-01").output).toContain(`prefix-hint=${HINTED_NEXT}`);
            expect(circuit("apply", "cpe-01", "--confirm").status).toBe(0);
            expect(circuit("diff", "cpe-01").status).toBe(0);

            // The client asks at once for the prefix it holds, with no hint, and edge-01 gives it again.
            expect(eventually(() => circuit("exec", "edge-01", "/log print").output.includes(`rebound: ${HINTED}`))).toBe(true);
            expect(held()).toBe(HINTED);

            // As a person would: the client off while the session comes back, which ends edge-01's binding, then on, so it asks with a Solicit.
            await typed(cpeRest!, "/ipv6 dhcp-client disable [find interface=internet]");
            await typed(cpeRest!, "/interface pppoe-client disable internet");
            expect(eventually(() => sessionAddress() === undefined)).toBe(true);
            await typed(cpeRest!, "/interface pppoe-client enable internet");
            expect(eventually(() => sessionAddress() !== undefined)).toBe(true);
            await typed(cpeRest!, "/ipv6 dhcp-client enable [find interface=internet]");

            expect(eventually(() => held() === HINTED_NEXT)).toBe(true);
            let hosts: string | undefined;
            const inNext = () => {
                hosts = hostsAddress();
                return hosts !== undefined && Address.contains(HINTED_NEXT, hosts);
            };
            expect(eventually(inNext)).toBe(true);
            expect(answers(hosts!)).toBe(true);

            await typed(edgeRest!, '/system logging remove [find topics="dhcp;debug"]');
            expect(circuit("diff", "cpe-01").status).toBe(0);
            expect(circuit("diff", "edge-01").status).toBe(0);
        },
        TEST_MS
    );

    test(
        "apply takes the prefix hint back, and cpe-01 keeps the prefix it holds",
        () => {
            writeCpe(true, subscriber);
            expect(circuit("diff", "cpe-01").output).toContain("prefix-hint=::/0");
            expect(circuit("apply", "cpe-01", "--confirm").status).toBe(0);
            expect(circuit("diff", "cpe-01").status).toBe(0);

            expect(circuit("exec", "cpe-01", "/ipv6 dhcp-client export").output).not.toContain("prefix-hint");
            expect(eventually(() => held() === HINTED_NEXT)).toBe(true);
        },
        TEST_MS
    );
});
