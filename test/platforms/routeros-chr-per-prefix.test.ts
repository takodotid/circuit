// Three RouterOS CHRs, which the devices workflow boots. edge-01 routes between cpe-01 and host-01, and limits each address of host-01 on its own. cpe-01 sends to several at once and pulls from them, and host-01 counts what reaches each. An unlicensed CHR sends at most 1 Mbit/s from each interface. Skipped without the CHRs.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Ssh } from "../../src/transport/ssh";

/** Each CHR's SSH, as `host:port`. Each has the user `operator`, with the password in CIRCUIT_TEST_CHR_PASSWORD. */
const edgeChr = process.env.CIRCUIT_TEST_CHR;
const cpeChr = process.env.CIRCUIT_TEST_CHR_B;
const hostChr = process.env.CIRCUIT_TEST_CHR_C;
const password = process.env.CIRCUIT_TEST_CHR_PASSWORD ?? "";

const repo = join(import.meta.dir, "..", "..");
const folder = realpathSync(mkdtempSync(join(tmpdir(), "circuit-chr-per-prefix-")));

/** A test applies to a router, and sends traffic for a while. */
const TEST_MS = 300_000;

/** host-01's addresses, on its loopback: two IPv4 addresses, two IPv6 addresses in one /64, and one in another /64. */
const ADDRESSES = { a: "203.0.113.1", b: "203.0.113.2", a6: "2001:db8:4::1", b6: "2001:db8:4::2", c6: "2001:db8:4:1::1" } as const;
type Name = keyof typeof ADDRESSES;

/** The rate of each prefix, what cpe-01 sends each address, and the rate of the interface as a whole, in kbit/s. */
const EACH = 100;
const SENT = 300;
const WHOLE = 150;

/** How long cpe-01 sends, how long it sends before host-01 counts, and how long host-01 counts. */
const SEND_SECONDS = 20;
const FILL_MS = 8000;
const COUNT_SECONDS = 10;
const KBIT = 1000;
const BITS_PER_BYTE = 8;

/** How far a measured rate may be from its limit: a bandwidth test and a firewall rule count other headers. */
const MARGIN = 0.25;

const UNITS: Record<string, number> = { "": 1, k: 1e3, M: 1e6, G: 1e9 };

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

/** Runs a command on a CHR over SSH, for what `circuit exec` refuses: a bandwidth test, or a rule that counts. */
async function onChr(chr: string, command: string): Promise<string> {
    const [host, port] = chr.split(":");
    const client = await Ssh.connect({ host: host!, port: Number(port), user: "operator+ct", password: () => password });
    try {
        const output = await Ssh.exec(client, command);
        console.log(`$ ${chr} ${command}\n${output}`);
        return output;
    } finally {
        client.end();
    }
}

/** The firewall menu of an address's family. */
const menu = (name: Name) => (ADDRESSES[name].includes(":") ? "/ipv6 firewall mangle" : "/ip firewall mangle");

/** cpe-01 sends each of `names` its own UDP at `SENT`. Once the queues are full, host-01 counts what reaches each, in kbit/s. */
async function sendTo(...names: Name[]): Promise<Record<Name, number>> {
    const sending = names.map((name) =>
        onChr(
            cpeChr!,
            `/tool bandwidth-test address=${ADDRESSES[name]} direction=transmit protocol=udp local-tx-speed=${SENT}k duration=${SEND_SECONDS}s`
        )
    );
    await Bun.sleep(FILL_MS);

    const get = (name: Name) => `[${menu(name)} get [find comment=${name}] bytes]`;
    const before = names.map((name) => `:local ${name} ${get(name)}`).join("; ");
    const after = names.map((name) => `:put ("${name} " . (${get(name)} - $${name}))`).join("; ");
    const printed = await onChr(hostChr!, `${before}; :delay ${COUNT_SECONDS}s; ${after}`);
    await Promise.all(sending);

    const counted = Object.fromEntries(
        [...printed.matchAll(/^(\S+) (\d+)$/gm)].map(([, name, bytes]) => [name, (Number(bytes) * BITS_PER_BYTE) / COUNT_SECONDS / KBIT])
    ) as Record<Name, number>;
    console.log(`reached host-01: ${JSON.stringify(counted)}`);
    return counted;
}

/** cpe-01 asks each of `names` at once to send it UDP at `SENT`, and returns the rate it got from each over the last 10 seconds, in kbit/s. The bandwidth server sends from the address cpe-01 asked. */
async function pullFrom(...names: Name[]): Promise<Record<Name, number>> {
    const outputs = await Promise.all(
        names.map((name) =>
            onChr(
                cpeChr!,
                `/tool bandwidth-test address=${ADDRESSES[name]} direction=receive protocol=udp remote-tx-speed=${SENT}k duration=${SEND_SECONDS}s`
            )
        )
    );
    return Object.fromEntries(
        names.map((name, index) => {
            const last = [...outputs[index]!.matchAll(/rx-10-second-average: ([\d.]+)([kMG]?)bps/g)].at(-1);
            if (!last) throw new Error(`the bandwidth test from ${ADDRESSES[name]} printed no average`);
            return [name, (Number(last[1]) * UNITS[last[2]!]!) / KBIT];
        })
    ) as Record<Name, number>;
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

/** edge-01, with this rate limit on its VLAN interface to host-01. */
function writeEdge(rateLimit: string): void {
    writeDevice(
        "edge-01",
        edgeChr!,
        `management: { allow: ["10.0.0.0/24"], ssh: {} },
    interfaces: {
        ethernet: {
            "virtual-1": { description: "Management", addresses: ["10.0.0.1/24"] },
            "virtual-2": { description: "cpe-01", addresses: ["192.0.2.1/30", "2001:db8:2::1/64"] },
            "virtual-3": { description: "host-01", access_vlan: "hosts" },
        },
        vlan_interface: {
            hosts: { vlan: "hosts", addresses: ["198.51.100.1/30", "2001:db8:3::1/64"]${rateLimit ? `, rate_limit: ${rateLimit}` : ""} },
        },
    },
    switching: { vlans: { hosts: { id: 10 } } },
    routing: {
        static_routes: [
            { prefix: "203.0.113.0/29", next_hop: "198.51.100.2" },
            { prefix: "2001:db8:4::/48", next_hop: "2001:db8:3::2" },
        ],
    },`
    );
}

/** Applies edge-01, and checks that `diff` then finds nothing to change. */
function apply(): void {
    circuit("diff", "edge-01");
    expect(circuit("apply", "edge-01", "--confirm").status).toBe(0);
    expect(circuit("diff", "edge-01").status).toBe(0);
}

/** Each prefix's rate, both ways, with these prefix lengths. */
const perPrefix = (ipv4: number, ipv6: number) => `{ ipv4: ${ipv4}, ipv6: ${ipv6}, input: "${EACH}k", output: "${EACH}k" }`;

describe.skipIf(!edgeChr || !cpeChr || !hostChr)("a CHR limits each prefix on its own", () => {
    beforeAll(() => {
        write("circuit.ts", `export const lab = circuit({ sites: { lab: { description: "Three CHRs, linked port to port." } } });\n`);

        writeEdge(`{ per_prefix: ${perPrefix(32, 64)} }`);
        writeDevice(
            "cpe-01",
            cpeChr!,
            `management: { allow: ["10.0.1.0/24"], ssh: {} },
    interfaces: {
        ethernet: {
            "virtual-1": { description: "Management", addresses: ["10.0.1.1/24"] },
            "virtual-2": { description: "edge-01", addresses: ["192.0.2.2/30", "2001:db8:2::2/64"] },
        },
    },
    routing: {
        static_routes: [
            { prefix: "203.0.113.0/29", next_hop: "192.0.2.1" },
            { prefix: "2001:db8:4::/48", next_hop: "2001:db8:2::1" },
        ],
    },`
        );
        // The addresses are on a loopback, as RouterOS's own interface is named lo.
        const loopback = Object.values(ADDRESSES).map((address) => `${address}/${address.includes(":") ? 128 : 32}`);
        writeDevice(
            "host-01",
            hostChr!,
            `management: { allow: ["10.0.2.0/24"], ssh: {} },
    interfaces: {
        ethernet: {
            "virtual-1": { description: "Management", addresses: ["10.0.2.1/24"] },
            "virtual-2": { description: "edge-01", addresses: ["198.51.100.2/30", "2001:db8:3::2/64"] },
        },
        loopback: { loopback: { addresses: ${JSON.stringify(loopback)} } },
    },
    routing: {
        static_routes: [
            { prefix: "192.0.2.0/30", next_hop: "198.51.100.1" },
            { prefix: "2001:db8:2::/64", next_hop: "2001:db8:3::1" },
        ],
    },`
        );
    });

    afterAll(() => rmSync(folder, { recursive: true, force: true }));

    test(
        "a queue type for each direction is set, and diff then finds nothing to change",
        async () => {
            for (const device of ["cpe-01", "host-01"]) {
                expect(circuit("apply", device, "--confirm").status).toBe(0);
                expect(circuit("diff", device).status).toBe(0);
            }
            apply();
            circuit("exec", "edge-01", "/queue type print detail where kind=pcq");
            circuit("exec", "edge-01", "/queue simple print detail");

            // A bandwidth test needs its server, which Circuit turns off. host-01 counts the UDP that reaches each address.
            for (const chr of [cpeChr!, hostChr!]) await onChr(chr, "/tool bandwidth-server set enabled=yes authenticate=no");
            for (const [name, address] of Object.entries(ADDRESSES) as [Name, string][])
                await onChr(
                    hostChr!,
                    `${menu(name)} add chain=prerouting protocol=udp dst-address=${address} action=passthrough comment=${name}`
                );
        },
        TEST_MS
    );

    test(
        "each IPv4 address gets the rate on its own, each way",
        async () => {
            const reached = await sendTo("a", "b");
            const pulled = await pullFrom("a", "b");
            for (const rate of [reached.a, reached.b, pulled.a, pulled.b]) {
                expect(rate).toBeGreaterThan(EACH * (1 - MARGIN));
                expect(rate).toBeLessThan(EACH * (1 + MARGIN));
            }
        },
        TEST_MS
    );

    test(
        "two IPv6 addresses in one /64 share its rate, and another /64 has its own, each way",
        async () => {
            const reached = await sendTo("a6", "b6", "c6");
            expect(reached.a6 + reached.b6).toBeLessThan(EACH * (1 + MARGIN));
            expect(reached.a6 + reached.b6).toBeGreaterThan(EACH * (1 - MARGIN));
            expect(reached.c6).toBeGreaterThan(EACH * (1 - MARGIN));
            expect(reached.c6).toBeLessThan(EACH * (1 + MARGIN));

            const pulled = await pullFrom("a6", "c6");
            for (const rate of [pulled.a6, pulled.c6]) {
                expect(rate).toBeGreaterThan(EACH * (1 - MARGIN));
                expect(rate).toBeLessThan(EACH * (1 + MARGIN));
            }
        },
        TEST_MS
    );

    test(
        "a shorter prefix shares one rate, and a rate for the whole interface caps the prefixes together",
        async () => {
            writeEdge(`{ per_prefix: ${perPrefix(24, 64)} }`);
            apply();
            const shared = await sendTo("a", "b");
            expect(shared.a + shared.b).toBeLessThan(EACH * (1 + MARGIN));

            writeEdge(`{ output: "${WHOLE}k", per_prefix: ${perPrefix(32, 64)} }`);
            apply();
            const capped = await sendTo("a", "b");
            expect(capped.a).toBeLessThan(EACH * (1 + MARGIN));
            expect(capped.a + capped.b).toBeLessThan(WHOLE * (1 + MARGIN));
            expect(capped.a + capped.b).toBeGreaterThan(WHOLE * (1 - MARGIN));
        },
        TEST_MS
    );

    test(
        "without per_prefix, its queue types are removed, and without the rate limit, its queue",
        async () => {
            writeEdge(`{ output: "${WHOLE}k" }`);
            apply();
            expect((await onChr(edgeChr!, ':put [:len [/queue type find kind=pcq name~"^hosts-rate-limit"]]')).trim()).toBe("0");
            const whole = await sendTo("a", "b");
            expect(whole.a + whole.b).toBeLessThan(WHOLE * (1 + MARGIN));

            writeEdge("");
            apply();
            expect((await onChr(edgeChr!, ":put [:len [/queue simple find]]")).trim()).toBe("0");
        },
        TEST_MS
    );
});
