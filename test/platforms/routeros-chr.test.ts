// Circuit against a RouterOS CHR, which the devices workflow boots: the edge router example is applied, changed, and changed back, and after each apply `diff` finds the device matching. Skipped without a CHR.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** The CHR's SSH, as `host:port`. Its user `operator` has the password in CIRCUIT_TEST_CHR_PASSWORD. */
const chr = process.env.CIRCUIT_TEST_CHR;

const repo = join(import.meta.dir, "..", "..");
const folder = realpathSync(mkdtempSync(join(tmpdir(), "circuit-chr-")));
const deviceFile = join(folder, "sites", "pop-1", "edge-01.ts");

/** An apply reads the device, saves a backup, sends the plan, and logs in again. */
const APPLY_MS = 600_000;

/** Runs Circuit from the sources in the copy, and prints what it printed, so the job's log shows each plan. */
function circuit(...args: string[]): { status: number | null; output: string } {
    const run = spawnSync("bun", [join(repo, "src", "cli", "index.ts"), ...args], {
        cwd: folder,
        encoding: "utf8",
        env: { ...process.env, EDGE_01_PASSWORD: process.env.CIRCUIT_TEST_CHR_PASSWORD },
    });
    const output = `${run.stdout}${run.stderr}`;
    console.log(`$ circuit ${args.join(" ")}\n${output}`);
    return { status: run.status, output };
}

/** `text` with `from` replaced. It throws when the example no longer holds `from`, so this test is adapted with the example. */
function replaced(text: string, from: string | RegExp, to: string | ((match: string, ...groups: string[]) => string)): string {
    const found = typeof from === "string" ? text.includes(from) : new RegExp(from).test(text);
    if (!found) throw new Error(`The edge router example no longer holds ${String(from)}. Adapt this test to it.`);
    return typeof to === "string" ? text.replace(from, to) : text.replace(from, to);
}

describe.skipIf(!chr)("a CHR", () => {
    let example = "";

    beforeAll(() => {
        cpSync(join(repo, "examples", "edge-router"), folder, { recursive: true });
        const [host, port] = chr!.split(":");

        let text = readFileSync(deviceFile, "utf8");
        text = replaced(text, 'model: "CCR2216-1G-12XS-2XQ"', 'model: "CHR"');
        text = replaced(text, 'host: "10.0.0.1"', `host: "${host}", port: ${port}`);
        // A CHR has no switch chip to hold an ACL. Its ports are its adapters: the management port is the first, and the example's 25G ports the next two.
        text = replaced(text, /\n\s*\/\/ #region edge-acl[\s\S]*?\/\/ #endregion edge-acl/, "");
        text = replaced(text, /, ingress_acl: "edge"/g, "");
        text = replaced(text, '"1g-1"', '"virtual-1"');
        text = replaced(text, /"25g-(\d+)"/g, (_, n: string) => `"virtual-${Number(n) + 1}"`);

        example = text;
        writeFileSync(deviceFile, example);
    });

    afterAll(() => rmSync(folder, { recursive: true, force: true }));

    test(
        "apply makes it match the edge router example, and disables the adapter the config leaves out",
        () => {
            const planned = circuit("diff", "edge-01");
            expect(planned.status).toBe(1);
            expect(planned.output).toContain("set [ find default-name=ether4 ] disabled=yes");
            expect(circuit("apply", "edge-01", "--confirm").status).toBe(0);
            expect(circuit("diff", "edge-01").status).toBe(0);
        },
        APPLY_MS
    );

    test(
        "a BGP neighbor, a static route, and a firewall rule are added, then removed",
        () => {
            let changed = replaced(
                example,
                '"de-cix-rs-v4": {',
                `"de-cix-rs2-v4": {
                    address: "192.0.2.2",
                    remote_as: 6695,
                    description: "DE-CIX route server 2",
                    role: "rs",
                    max_prefixes: 100_000,
                    import_policy: "exchange-import",
                    export_policy: "export",
                    communities: { groups: ["exchange"] },
                },
                "de-cix-rs-v4": {`
            );
            changed = replaced(
                changed,
                "static_routes: [",
                'static_routes: [\n            { prefix: "203.0.113.64/26", next_hop: "203.0.113.1", description: "Through the transit" },'
            );
            changed = replaced(
                changed,
                '{ description: "Ping", if: { protocol: "icmp" }, then: "accept" },',
                '{ description: "Ping", if: { protocol: "icmp" }, then: "accept" },\n                    { description: "Traceroute", if: { protocol: "udp", dst_port: { min: 33434, max: 33534 } }, then: "accept" },'
            );

            writeFileSync(deviceFile, changed);
            const added = circuit("diff", "edge-01");
            expect(added.status).toBe(1);
            expect(added.output).toContain("name=de-cix-rs2-v4");
            expect(added.output).toContain("203.0.113.64/26");
            expect(added.output).toContain("33434-33534");
            expect(circuit("apply", "edge-01", "--confirm").status).toBe(0);
            expect(circuit("diff", "edge-01").status).toBe(0);

            writeFileSync(deviceFile, example);
            expect(circuit("apply", "edge-01", "--confirm").status).toBe(0);
            expect(circuit("diff", "edge-01").status).toBe(0);
        },
        APPLY_MS
    );

    test(
        "uRPF, one mode for the whole router, goes from the example's loose to strict, then back to the default",
        () => {
            writeFileSync(deviceFile, replaced(example, /urpf: \{ ipv4: "loose" \}/g, 'urpf: { ipv4: "strict" }'));
            expect(circuit("diff", "edge-01").output).toContain("rp-filter=strict");
            expect(circuit("apply", "edge-01", "--confirm").status).toBe(0);
            expect(circuit("diff", "edge-01").status).toBe(0);

            writeFileSync(deviceFile, replaced(example, /, urpf: \{ ipv4: "loose" \}/g, ""));
            expect(circuit("diff", "edge-01").output).toContain("rp-filter=no");
            expect(circuit("apply", "edge-01", "--confirm").status).toBe(0);
            expect(circuit("diff", "edge-01").status).toBe(0);
        },
        APPLY_MS
    );
});
