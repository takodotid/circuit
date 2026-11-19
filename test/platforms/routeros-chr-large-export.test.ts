// A RouterOS CHR, which the devices workflow boots, with the edge router example and thousands of firewall rules more. Its export passes the 2 MiB RouterOS sends over SSH (#314). Skipped without a CHR.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Ssh } from "../../src/transport/ssh";

/** The CHR's SSH, as `host:port`. Its user `operator` has the password in CIRCUIT_TEST_CHR_PASSWORD. */
const chr = process.env.CIRCUIT_TEST_CHR;
const password = process.env.CIRCUIT_TEST_CHR_PASSWORD ?? "";

const repo = join(import.meta.dir, "..", "..");
const folder = realpathSync(mkdtempSync(join(tmpdir(), "circuit-chr-large-")));
const deviceFile = join(folder, "sites", "pop-1", "edge-01.ts");

/** The most RouterOS sends over SSH (CHR, 7.24.6). */
const SSH_OUTPUT_BYTES = 2 * 1024 * 1024;

/** Rules of about 300 bytes each in the export, 2.4 MB in all. */
const RULES = 8000;
const DESCRIPTION_CHARS = 200;
const FIRST_PORT = 20_000;

/** Applies of 8,000 rules, and reads of 2.4 MB at the 1 Mbit/s a CHR without a license sends. */
const TEST_MS = 1_200_000;

/** What Circuit may print: a plan of 8,000 rules is about 2 MB, past the 1 MiB `spawnSync` keeps by default. */
const OUTPUT_BYTES = 64 * 1024 * 1024;

/** Runs Circuit from the sources in the copy, and prints what it printed, so the job's log shows each plan. */
function circuit(...args: string[]): { status: number | null; output: string } {
    const run = spawnSync("bun", [join(repo, "src", "cli", "index.ts"), ...args], {
        cwd: folder,
        encoding: "utf8",
        maxBuffer: OUTPUT_BYTES,
        env: { ...process.env, EDGE_01_PASSWORD: password },
    });
    const output = `${run.stdout}${run.stderr}`;
    console.log(`$ circuit ${args.join(" ")}\n${output.slice(0, 4000)}`);
    return { status: run.status, output };
}

/** Runs one command on the CHR over SSH, as Circuit logs in. */
async function onChr(command: string): Promise<string> {
    const [host, port] = chr!.split(":");
    const client = await Ssh.connect({ host: host!, port: Number(port), user: "operator", password: () => password });
    try {
        return await Ssh.exec(client, command);
    } finally {
        client.end();
    }
}

/** `text` with `from` replaced. It throws when the example no longer holds `from`, so this test is adapted with the example. */
function replaced(text: string, from: string | RegExp, to: string | ((match: string, ...groups: string[]) => string)): string {
    const found = typeof from === "string" ? text.includes(from) : new RegExp(from).test(text);
    if (!found) throw new Error(`The edge router example no longer holds ${String(from)}. Adapt this test to it.`);
    return typeof to === "string" ? text.replace(from, to) : text.replace(from, to);
}

describe.skipIf(!chr)("a CHR with an export larger than SSH carries", () => {
    let example = "";

    // As routeros-chr.test.ts adapts the example to a CHR.
    beforeAll(() => {
        cpSync(join(repo, "examples", "edge-router"), folder, { recursive: true });
        const [host, port] = chr!.split(":");

        let text = readFileSync(deviceFile, "utf8");
        text = replaced(text, 'model: "CCR2216-1G-12XS-2XQ"', 'model: "CHR"');
        text = replaced(text, 'host: "10.0.0.1"', `host: "${host}", port: ${port}`);
        text = replaced(text, /\n\s*\/\/ #region edge-acl[\s\S]*?\/\/ #endregion edge-acl/, "");
        text = replaced(text, /, ingress_acl: "edge"/g, "");
        text = replaced(text, '"1g-1"', '"virtual-1"');
        text = replaced(text, /"25g-(\d+)"/g, (_, n: string) => `"virtual-${Number(n) + 1}"`);

        example = text;
        writeFileSync(deviceFile, example);
    });

    afterAll(() => rmSync(folder, { recursive: true, force: true }));

    test(
        "the plan is empty after an apply, and a user whose group cannot write the file gets an error, not a plan",
        async () => {
            const filler = "x".repeat(DESCRIPTION_CHARS);
            const rules = Array.from(
                { length: RULES },
                (_, n) =>
                    `{ description: "Rule ${n} ${filler}", if: { family: "ipv4", protocol: "tcp", dst_port: ${FIRST_PORT + n} }, then: "drop" },`
            );
            let large = replaced(example, "rules: presets.bad_tcp_flags,", `rules: [...presets.bad_tcp_flags,\n${rules.join("\n")}\n],`);
            // An operator's group, write, has no ftp policy.
            large = replaced(
                large,
                'users: { operator: { role: "admin", password: secret("EDGE_01_PASSWORD") } },',
                'users: { operator: { role: "admin", password: secret("EDGE_01_PASSWORD") }, reader: { role: "operator", password: secret("EDGE_01_PASSWORD") } },'
            );

            writeFileSync(deviceFile, large);
            expect(circuit("apply", "edge-01", "--confirm").status).toBe(0);
            const size = await onChr(
                '/export file=circuit-chr-size; :put [/file get circuit-chr-size.rsc size]; /file remove [find name="circuit-chr-size.rsc"]'
            );
            expect(Number(size)).toBeGreaterThan(SSH_OUTPUT_BYTES);
            const after = circuit("diff", "edge-01");
            expect(after.output).toContain("edge-01 already matches its config.");
            expect(after.status).toBe(0);

            writeFileSync(deviceFile, replaced(large, 'user: "operator"', 'user: "reader"'));
            const refused = circuit("diff", "edge-01");
            expect(refused.output).toContain("edge-01: the export over SSH stopped before its end");
            expect(refused.output).toContain('set system.users.reader.role to "admin"');
            expect(refused.output).not.toContain("command(s) in");
            expect(await onChr(':put [:len [/file find name~"^circuit-read-"]]')).toBe("0");

            writeFileSync(deviceFile, example);
            expect(circuit("apply", "edge-01", "--confirm").status).toBe(0);
            expect(circuit("diff", "edge-01").status).toBe(0);
        },
        TEST_MS
    );
});
