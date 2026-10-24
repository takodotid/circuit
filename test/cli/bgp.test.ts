// `circuit bgp` end to end against a fake router: why each session is down, several limits closed at once, and clearing only what closed on its limit.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { FakeSshDevice } from "../platforms/fake-ssh";

const root = resolve(import.meta.dirname, "../..");

/** The router after a leak: a route server's IPv4 session closed on its limit, IPv6 still connecting. */
const LEAK = [
    "he-1|203.0.113.1|true|987654|1w2d03:04:05|||",
    "sgix-rs-v4-1|192.0.2.1||0||true|20000|2026-10-24 21:57:06",
    "sgix-rs-v6-1|2001:db8:ffff::1||0||||",
].join("\n");

let sessions = LEAK;
const cleared: string[] = [];

const fake = new FakeSshDevice("operator+ct300w", (command) => {
    if (command.startsWith(":foreach s in=[/routing bgp session find]")) return sessions + "\n";
    if (command.startsWith("/routing bgp session clear ")) {
        cleared.push(command);
        sessions = sessions.replace("sgix-rs-v4-1|192.0.2.1||0||true|20000|2026-10-24 21:57:06", "sgix-rs-v4-1|192.0.2.1|true|12|2s|||");
        return "";
    }
    return `bad command name ${command}\n`;
});

let directory = "";

beforeAll(async () => {
    const port = await fake.listen();
    directory = mkdtempSync(join(tmpdir(), "circuit-bgp-"));
    const edge = join(root, "templates/edge-router/edge-01.ts").replaceAll("\\", "/");

    writeFileSync(
        join(directory, "circuit.config.ts"),
        [
            `import { defineNetwork } from "${join(root, "src/index.ts").replaceAll("\\", "/")}";`,
            `import edge from "${edge}";`,
            `const neighbors = { ...edge.routing.bgp.neighbors, "sgix-rs2-v4": { address: "192.0.2.2", remote_as: 64512 } };`,
            `export default defineNetwork({ devices: [{ ...edge, connection: { host: "127.0.0.1", port: ${port}, user: "operator" }, routing: { ...edge.routing, bgp: { ...edge.routing.bgp, neighbors } } }] });`,
        ].join("\n")
    );
});

afterAll(() => {
    fake.close();
    rmSync(directory, { recursive: true, force: true });
});

/** Run the CLI without blocking the fake device, which answers in this process. */
function circuit(...args: string[]): Promise<{ status: number | null; stdout: string; stderr: string }> {
    return new Promise((done) => {
        const child = spawn("bun", [join(root, "src/cli/index.ts"), ...args, `--config=${join(directory, "circuit.config.ts")}`], {
            cwd: directory,
            env: { ...process.env, EDGE_01_PASSWORD: FakeSshDevice.PASSWORD },
        });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk) => (stdout += chunk));
        child.stderr.on("data", (chunk) => (stderr += chunk));
        child.on("close", (status) => done({ status, stdout, stderr }));
    });
}

test("each down session says why, and two limits closed minutes apart are called a leak", async () => {
    sessions = LEAK + "\nsgix-rs2-v4-1|192.0.2.2||0||true|20000|2026-10-24 21:57:13";
    const { status, stdout } = await circuit("bgp", "edge-01");

    expect(status).toBe(0);
    expect(stdout).toContain("192.0.2.1  limit exceeded: over 20000 prefixes, closed 2026-10-24 21:57:06");
    expect(stdout).toContain("2001:db8:ffff::1  connecting");
    expect(stdout).toContain(
        "sgix-rs-v4 and sgix-rs2-v4 closed on their prefix limit within 7 s of each other, from 2026-10-24 21:57:06. Several limits at once is usually a leak upstream, not growth"
    );
});

test("--clear-limit opens only the sessions closed on their limit, and refuses when none is", async () => {
    sessions = LEAK;
    cleared.length = 0;

    const nothing = await circuit("bgp", "edge-01", "hurricane", "--clear-limit");
    expect(nothing.status).toBe(1);
    expect(nothing.stderr).toContain("no neighbor shown is closed on its prefix limit, so nothing was cleared");
    expect(cleared).toEqual([]);

    const { status, stdout } = await circuit("bgp", "edge-01", "sgix", "--clear-limit");
    expect(status).toBe(0);
    expect(stdout).toContain("sgix-rs-v6: left alone, not closed on its limit");
    expect(cleared).toEqual(["/routing bgp session clear [find remote.address=192.0.2.1 and limit-exceeded] flag=limit-exceeded"]);
    expect(stdout).toMatch(/sgix-rs-v4 +up/);
});
