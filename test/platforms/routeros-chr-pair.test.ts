// Two RouterOS CHRs, which the devices workflow boots with the first's ether2 linked to the second's. edge-01 (AS64500) sells transit to cpe-01 (AS64501) over eBGP, with GTSM on both sides. The tests run in order on the same two routers. Skipped without both CHRs.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Ssh } from "../../src/transport/ssh";

/** Each CHR's SSH, as `host:port`. Both have the user `operator`, with the password in CIRCUIT_TEST_CHR_PASSWORD. */
const edgeChr = process.env.CIRCUIT_TEST_CHR;
const cpeChr = process.env.CIRCUIT_TEST_CHR_B;
const password = process.env.CIRCUIT_TEST_CHR_PASSWORD ?? "";

const repo = join(import.meta.dir, "..", "..");
const folder = realpathSync(mkdtempSync(join(tmpdir(), "circuit-chr-pair-")));

/** A test applies, and waits for BGP, several times. */
const TEST_MS = 300_000;

/** How long a session has to come up, or a route to arrive or leave. */
const WAIT_MS = 60_000;

const POLL_MS = 3000;

const SECOND_MS = 1000;

/** How long edge-01 must keep the session down while cpe-01 sends with TTL 1. With a TTL it accepts, the session comes up within seconds. */
const GTSM_WATCH_MS = 30_000;

const EDGE_PREFIX = "198.51.100.0/24";
const CPE_PREFIX = "203.0.113.0/24";
const DEFAULT_ROUTE = "0.0.0.0/0";

const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;

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

/** The device's one BGP session, as `circuit bgp` shows it. */
function bgp(device: string): { up: boolean; uptime: string } {
    const { status, output } = circuit("bgp", device);
    expect(status).toBe(0);

    const cells = output
        .split("\n")
        .map((line) => line.split("│").map((cell) => cell.trim()))
        .find((row) => row[1] === (device === "edge-01" ? "cpe-01" : "edge-01"));
    if (!cells) throw new Error(`circuit bgp ${device} shows no session`);

    const [, , state = "", , uptime = ""] = cells;
    return { up: state === "up", uptime };
}

/** How many active routes the device has to `prefix`. A route to the other router's prefix, or a default route, can only come from BGP here. */
function activeRoutes(device: string, prefix: string): number {
    const { status, output } = circuit("exec", device, `:put [:len [/ip route find where dst-address="${prefix}" and active]]`);
    expect(status).toBe(0);

    const count = output
        .split("\n")
        .map((line) => line.trim())
        .findLast((line) => /^\d+$/.test(line));
    if (count === undefined) throw new Error(`circuit exec ${device} printed no count`);
    return Number(count);
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

/** An uptime of less than a day, as `circuit bgp` shows it, `00:01:05.250`, in seconds. */
function seconds(uptime: string): number {
    const clock = /^(\d+):(\d+):(\d+(?:\.\d+)?)$/.exec(uptime);
    if (!clock) throw new Error(`${uptime} is not an uptime of less than a day`);

    const [, hours, minutes, rest] = clock;
    return (Number(hours) * MINUTES_PER_HOUR + Number(minutes)) * SECONDS_PER_MINUTE + Number(rest);
}

/** Runs a command on cpe-01 over SSH, for a change Circuit's config cannot make. */
async function onCpe(command: string): Promise<string> {
    const [host, port] = cpeChr!.split(":");
    const client = await Ssh.connect({ host: host!, port: Number(port), user: "operator", password: () => password });
    try {
        return await Ssh.exec(client, command);
    } finally {
        client.end();
    }
}

/** A file of the lab project. */
function write(path: string, text: string): void {
    mkdirSync(dirname(join(folder, path)), { recursive: true });
    writeFileSync(join(folder, path), text);
}

/** edge-01, with `neighbor` added to its neighbor cpe-01, and `exportRules` as the rules of its export to cpe-01. */
function writeEdge(neighbor: string, exportRules: string): void {
    const [host, port] = edgeChr!.split(":");
    write(
        "sites/lab/edge-01.ts",
        `import { lab } from "../../circuit";

export default lab.device({
    name: "edge-01",
    site: "lab",
    platform: "routeros",
    model: "CHR",
    connection: { host: "${host}", port: ${port}, user: "operator" },
    system: { users: { operator: { role: "admin", password: secret("OPERATOR_PASSWORD") } } },
    management: { allow: ["10.0.0.0/24"], ssh: {} },
    interfaces: {
        ethernet: {
            "virtual-1": { description: "Management", addresses: ["10.0.0.1/24"] },
            "virtual-2": { description: "cpe-01", addresses: ["192.0.2.1/30"] },
        },
    },
    routing: {
        router_id: "192.0.2.1",
        static_routes: [{ prefix: "${EDGE_PREFIX}", blackhole: true }],
        bgp: {
            asn: 64500,
            originated_prefixes: ["${EDGE_PREFIX}"],
            neighbors: {
                "cpe-01": {
                    address: "192.0.2.2",
                    remote_as: 64501,
                    role: "customer",
                    ttl_security: true,
                    import_policy: "from-cpe",
                    export_policy: "to-cpe",
                    ${neighbor}
                },
            },
        },
        policies: {
            "from-cpe": [{ if: { prefix: "${CPE_PREFIX}" }, then: "accept" }, { then: "reject" }],
            "to-cpe": [${exportRules}],
        },
    },
});
`
    );
}

/** edge-01's export to cpe-01 when it sends its own prefix. */
const ANNOUNCE_EDGE_PREFIX = `{ if: { prefix: "${EDGE_PREFIX}" }, then: "accept" }, { then: "reject" }`;

describe.skipIf(!edgeChr || !cpeChr)("two CHRs linked port to port", () => {
    beforeAll(() => {
        write("circuit.ts", `export const lab = circuit({ sites: { lab: { description: "Two CHRs, linked port to port." } } });\n`);

        const [host, port] = cpeChr!.split(":");
        write(
            "sites/lab/cpe-01.ts",
            `import { lab } from "../../circuit";

export default lab.device({
    name: "cpe-01",
    site: "lab",
    platform: "routeros",
    model: "CHR",
    connection: { host: "${host}", port: ${port}, user: "operator" },
    system: { users: { operator: { role: "admin", password: secret("OPERATOR_PASSWORD") } } },
    management: { allow: ["10.0.1.0/24"], ssh: {} },
    interfaces: {
        ethernet: {
            "virtual-1": { description: "Management", addresses: ["10.0.1.1/24"] },
            "virtual-2": { description: "edge-01", addresses: ["192.0.2.2/30"] },
        },
    },
    routing: {
        router_id: "192.0.2.2",
        static_routes: [{ prefix: "${CPE_PREFIX}", blackhole: true }],
        bgp: {
            asn: 64501,
            originated_prefixes: ["${CPE_PREFIX}"],
            neighbors: {
                "edge-01": {
                    address: "192.0.2.1",
                    remote_as: 64500,
                    role: "provider",
                    ttl_security: true,
                    import_policy: "from-edge",
                    export_policy: "to-edge",
                },
            },
        },
        policies: {
            "from-edge": [{ then: "accept" }],
            "to-edge": [{ if: { prefix: "${CPE_PREFIX}" }, then: "accept" }, { then: "reject" }],
        },
    },
});
`
        );
    });

    afterAll(() => rmSync(folder, { recursive: true, force: true }));

    // First: the check after an apply waits for each announcement it saw before, so a later apply that stops one on purpose could fail it.
    test(
        "after both apply, with GTSM on both sides, cpe-01 gets a default route and nothing else, through an export that rejects everything",
        () => {
            writeEdge("send_default_route: true,", `{ then: "reject" }`);

            // A diff first: the first export after a boot leaves out what the apply's read would then miss (TRAPS.md).
            for (const device of ["edge-01", "cpe-01"]) {
                expect(circuit("diff", device).status).toBe(1);
                expect(circuit("apply", device, "--confirm").status).toBe(0);
                expect(circuit("diff", device).status).toBe(0);
            }

            expect(eventually(() => bgp("edge-01").up)).toBe(true);
            expect(eventually(() => activeRoutes("cpe-01", DEFAULT_ROUTE) === 1)).toBe(true);
            expect(activeRoutes("cpe-01", EDGE_PREFIX)).toBe(0);
        },
        TEST_MS
    );

    test(
        "each router gets the prefix the other originates",
        () => {
            writeEdge("", ANNOUNCE_EDGE_PREFIX);
            expect(circuit("apply", "edge-01", "--confirm").status).toBe(0);
            expect(circuit("diff", "edge-01").status).toBe(0);

            expect(eventually(() => activeRoutes("cpe-01", EDGE_PREFIX) === 1)).toBe(true);
            expect(eventually(() => activeRoutes("cpe-01", DEFAULT_ROUTE) === 0)).toBe(true);
            expect(activeRoutes("edge-01", CPE_PREFIX)).toBe(1);
            expect(bgp("edge-01").up).toBe(true);
        },
        TEST_MS
    );

    test(
        "edge-01 keeps the session down while cpe-01 sends with TTL 1, and Circuit sets cpe-01 back",
        async () => {
            // Circuit's config cannot make RouterOS send with TTL 1: a session without ttl_security sends with 255 too (TRAPS.md). So it is set by hand, with the session closed first, so that edge-01 hears the close.
            const connection = '[find name="edge-01"]';
            expect(
                await onCpe(
                    `/routing bgp connection disable ${connection}; /routing bgp connection set ${connection} local.ttl=1; /routing bgp connection enable ${connection}`
                )
            ).toBe("");

            expect(eventually(() => !bgp("edge-01").up)).toBe(true);
            const watchEnd = Date.now() + GTSM_WATCH_MS;
            while (Date.now() < watchEnd) {
                expect(bgp("edge-01").up).toBe(false);
                Bun.sleepSync(POLL_MS);
            }
            expect(activeRoutes("edge-01", CPE_PREFIX)).toBe(0);

            const drift = circuit("diff", "cpe-01");
            expect(drift.status).toBe(1);
            expect(drift.output).toContain("local.ttl=255");
            expect(circuit("apply", "cpe-01", "--confirm").status).toBe(0);
            expect(eventually(() => bgp("edge-01").up)).toBe(true);
        },
        TEST_MS
    );

    test(
        "the check after an apply sees a session the apply restarted come back, announcing what it did",
        () => {
            writeEdge("hold_time: 90,", ANNOUNCE_EDGE_PREFIX);

            const started = Date.now();
            const applied = circuit("apply", "edge-01", "--confirm");
            const took = (Date.now() - started) / SECOND_MS;
            expect(applied.status).toBe(0);
            expect(applied.output).toContain("BGP: 1 session(s) were established before");
            expect(applied.output).toContain("BGP: all 1 established again");
            expect(applied.output).toContain("BGP: every session announces what it announced before");

            // Younger than the apply: it restarted, so the check saw it come back rather than stay up.
            expect(seconds(bgp("edge-01").uptime)).toBeLessThan(took);
            expect(circuit("diff", "edge-01").status).toBe(0);
        },
        TEST_MS
    );
});
