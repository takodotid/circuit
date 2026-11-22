// Policy-based IPsec on the three CHRs of the devices workflow. The first is the internet, and counts what it forwards. The second and the third each hold a network, and encrypt what goes between them: with a key, then other algorithms, then certificates, then a revoked one. Then the tunnel goes. No selector holds a management network. Skipped without the three CHRs.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawn, spawnSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Ssh } from "../../src/transport/ssh";

/** Each CHR's SSH, as `host:port`. Each has the user `operator`, with the password in CIRCUIT_TEST_CHR_PASSWORD. */
const internetChr = process.env.CIRCUIT_TEST_CHR;
const firstChr = process.env.CIRCUIT_TEST_CHR_B;
const secondChr = process.env.CIRCUIT_TEST_CHR_C;
const password = process.env.CIRCUIT_TEST_CHR_PASSWORD ?? "";

const repo = join(import.meta.dir, "..", "..");
const folder = realpathSync(mkdtempSync(join(tmpdir(), "circuit-chr-ipsec-")));

/** A test applies to three routers, and waits for IKE. */
const TEST_MS = 300_000;
/** How long a tunnel has to come up. */
const WAIT_MS = 60_000;
const POLL_MS = 3000;

/** One office: its router, its CHR, its management network, its link to the internet, and its network behind the tunnel. */
type Office = {
    name: string;
    chr: string;
    management: string;
    link: string;
    wan: string;
    wan6: string;
    lan: string;
    lan6: string;
    network: string;
    network6: string;
};

const FIRST: Office = {
    name: "office-01",
    chr: firstChr!,
    management: "10.0.1",
    link: "192.0.2.16/30",
    wan: "192.0.2.18",
    wan6: "2001:db8:ab::2",
    lan: "198.51.100.1",
    lan6: "2001:db8:b::1",
    network: "198.51.100.0/24",
    network6: "2001:db8:b::/64",
};
const SECOND: Office = {
    name: "office-02",
    chr: secondChr!,
    management: "10.0.2",
    link: "192.0.2.20/30",
    wan: "192.0.2.22",
    wan6: "2001:db8:ac::2",
    lan: "203.0.113.1",
    lan6: "2001:db8:c::1",
    network: "203.0.113.0/24",
    network6: "2001:db8:c::/64",
};
const OFFICES = [FIRST, SECOND];

/** The internet's ends of each office's link. */
const GATEWAY: Record<string, { v4: string; v6: string }> = {
    [FIRST.name]: { v4: "192.0.2.17", v6: "2001:db8:ab::1" },
    [SECOND.name]: { v4: "192.0.2.21", v6: "2001:db8:ac::1" },
};

/** The algorithms the tunnel starts with, then those it changes to: AES-GCM in ESP without PFS, other IKE algorithms, and no liveness checks. */
const ALGORITHMS = {
    first: `ike: { encryption: "aes-256-cbc", integrity: "hmac-sha2-256-128", prf: "hmac-sha2-256", dh_group: 14, lifetime: 28800 },
                esp: { encryption: "aes-256-cbc", integrity: "hmac-sha2-256-128", pfs_group: 14, lifetime: 3600 },`,
    changed: `ike: { encryption: "aes-128-cbc", integrity: "hmac-sha2-512-256", prf: "hmac-sha2-512", dh_group: 19, lifetime: 86400 },
                esp: { encryption: "aes-256-gcm", lifetime: 1800 },
                liveness_check: false,`,
};

/** How each office authenticates. */
type Authentication = "key" | "certificates";

/** What the lab writes beside the tunnel: whether office-01 has the CA's list of revoked certificates, and office-02's certificate. */
type Revocation = { crl?: boolean; certificate?: string };

/** office-02's certificate that the CA revokes. */
const REVOKED = "office-02-revoked";

/** Where the runner serves the CA's list, which each CHR reaches at .2 of its management network, QEMU's address for the runner. */
const CRL_PORT = 8000;

/** Runs Circuit from the sources in the lab project, and prints what it printed, so the job's log shows each plan. */
function circuit(...args: string[]): { status: number | null; output: string } {
    const run = spawnSync("bun", [join(repo, "src", "cli", "index.ts"), ...args], {
        cwd: folder,
        encoding: "utf8",
        env: { ...process.env, OPERATOR_PASSWORD: password, IPSEC_KEY: "circuit-lab-ipsec-key" },
    });
    const output = `${run.stdout}${run.stderr}`;
    console.log(`$ circuit ${args.join(" ")}\n${output}`);
    return { status: run.status, output };
}

/** A command on the runner, printed for the job's log. */
function shell(command: string): void {
    const run = spawnSync("sh", ["-c", command], { cwd: folder, encoding: "utf8" });
    console.log(`$ ${command}\n${run.stdout}${run.stderr}`);
    expect(run.status).toBe(0);
}

/** A command on a CHR as a person would type it, which `circuit exec` refuses when it changes something. */
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

/**
 * A CA for the offices, a certificate for each office, and one more for office-02 that the CA revokes, each as `certificates/<name>.pem` with its key beside it. The CA's list of what it revoked is `certificates/lab-ca.crl`, as RFC 5280 writes one: DER, with the CA's key identifier.
 */
function writeCertificates(): void {
    write(
        "certificates/ca/ca.cnf",
        [
            "[ ca ]",
            "default_ca = lab",
            "[ lab ]",
            "database = ca/index.txt",
            "new_certs_dir = ca",
            "certificate = lab-ca.pem",
            "private_key = ca/lab-ca.key",
            "serial = ca/serial",
            "crlnumber = ca/crlnumber",
            "default_md = sha256",
            "default_days = 30",
            "default_crl_days = 30",
            "policy = any",
            "unique_subject = no",
            "crl_extensions = list",
            "[ any ]",
            "commonName = supplied",
            "[ list ]",
            "authorityKeyIdentifier = keyid:always",
            "",
        ].join("\n")
    );
    write("certificates/ca/index.txt", "");
    write("certificates/ca/serial", "01\n");
    write("certificates/ca/crlnumber", "01\n");
    shell(
        'cd certificates && openssl req -x509 -newkey rsa:2048 -nodes -keyout ca/lab-ca.key -out lab-ca.pem -days 30 -subj "/CN=lab-ca" -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign,cRLSign" -addext "subjectKeyIdentifier=hash"'
    );
    for (const name of [...OFFICES.map((office) => office.name), REVOKED]) {
        write(
            `certificates/${name}.ext`,
            `subjectAltName=DNS:${name}.lab.example\nkeyUsage=digitalSignature\nauthorityKeyIdentifier=keyid\nsubjectKeyIdentifier=hash\n`
        );
        shell(
            `cd certificates && openssl req -new -newkey rsa:2048 -nodes -keyout ${name}.key -out ${name}.csr -subj "/CN=${name}" && openssl ca -batch -notext -config ca/ca.cnf -in ${name}.csr -out ${name}.pem -extfile ${name}.ext`
        );
    }
    shell(
        `cd certificates && openssl ca -config ca/ca.cnf -revoke ${REVOKED}.pem && openssl ca -config ca/ca.cnf -gencrl -out ca/lab-ca.crl.pem && openssl crl -in ca/lab-ca.crl.pem -outform DER -out lab-ca.crl && openssl crl -in ca/lab-ca.crl.pem -noout -text`
    );
}

/** internet-01, the internet between the offices. It routes their links, not their networks, and counts the ESP it forwards, and what an office's network sends in the clear. */
function writeInternet(): void {
    const [host, port] = internetChr!.split(":");
    write(
        "sites/lab/internet-01.ts",
        `import { lab } from "../../circuit";

export default lab.device({
    name: "internet-01",
    site: "lab",
    platform: "routeros",
    model: "CHR",
    connection: { host: "${host}", port: ${port}, user: "operator" },
    system: { users: { operator: { role: "admin", password: secret("OPERATOR_PASSWORD") } } },
    management: { allow: ["10.0.0.0/24"], ssh: {} },
    interfaces: {
        ethernet: {
            "virtual-1": { description: "Management", addresses: ["10.0.0.1/24"] },
            "virtual-2": { description: "office-01", addresses: ["192.0.2.17/30", "2001:db8:ab::1/64"] },
            "virtual-3": { description: "office-02", addresses: ["192.0.2.21/30", "2001:db8:ac::1/64"] },
        },
    },
    firewall: {
        filter: {
            forward: {
                rules: [
                    { description: "ESP", if: { protocol: "esp" }, then: "accept" },
                    { description: "office-01 in the clear", if: { src: "198.51.100.0/24" }, then: "accept" },
                    { description: "office-01 in the clear, IPv6", if: { src: "2001:db8:b::/64" }, then: "accept" },
                ],
            },
        },
    },
});
`
    );
}

/** An office's router: its network on a loopback, routes to the other office through the internet, and, unless `authentication` is left out, the tunnel. */
function writeOffice(office: Office, authentication?: Authentication, algorithms = ALGORITHMS.first, revocation: Revocation = {}): void {
    const [host, port] = office.chr.split(":");
    const far = office === FIRST ? SECOND : FIRST;
    const gateway = GATEWAY[office.name]!;
    const own = (office === SECOND && revocation.certificate) || office.name;
    // Only office-01 holds the list: the end that refuses a revoked certificate, which the test proves.
    const list = revocation.crl && office === FIRST ? `, crl_url: "http://${office.management}.2:${CRL_PORT}/lab-ca.crl"` : "";
    const certificates =
        authentication === "certificates"
            ? `certificates: {
            "lab-ca": { certificate_file: "certificates/lab-ca.pem"${list} },
            "${own}": { certificate_file: "certificates/${own}.pem", private_key: secretFile("certificates/${own}.key") },
        },`
            : "";
    const way =
        authentication === "certificates" ? `certificate: "${own}", ca_certificate: "lab-ca",` : `pre_shared_key: secret("IPSEC_KEY"),`;
    const tunnel = authentication
        ? `
    firewall: {
        ipsec: {
            "${far.name}": {
                description: "${far.name}",
                local_address: "${office.wan}",
                remote_address: "${far.wan}",
                traffic_selectors: [
                    { local_prefix: "${office.network}", remote_prefix: "${far.network}" },
                    { local_prefix: "${office.network6}", remote_prefix: "${far.network6}" },
                ],
                ${way}
                ${algorithms}
            },
        },
    },`
        : "";

    write(
        `sites/lab/${office.name}.ts`,
        `import { lab } from "../../circuit";

export default lab.device({
    name: "${office.name}",
    site: "lab",
    platform: "routeros",
    model: "CHR",
    connection: { host: "${host}", port: ${port}, user: "operator" },
    system: { users: { operator: { role: "admin", password: secret("OPERATOR_PASSWORD") } }, ${certificates} },
    management: { allow: ["${office.management}.0/24"], ssh: {} },
    interfaces: {
        ethernet: {
            "virtual-1": { description: "Management", addresses: ["${office.management}.1/24"] },
            "virtual-2": { description: "internet-01", addresses: ["${office.wan}/30", "${office.wan6}/64"] },
        },
        loopback: { lan: { description: "The office's network", addresses: ["${office.lan}/24", "${office.lan6}/64"] } },
    },
    routing: {
        static_routes: [
            { prefix: "${far.link}", next_hop: "${gateway.v4}" },
            { prefix: "${far.network}", next_hop: "${gateway.v4}" },
            { prefix: "${far.network6}", next_hop: "${gateway.v6}" },
        ],
    },${tunnel}
});
`
    );
}

/** The lab with the tunnel authenticated so, or without it. */
function writeLab(authentication?: Authentication, algorithms = ALGORITHMS.first, revocation: Revocation = {}): void {
    writeInternet();
    for (const office of OFFICES) writeOffice(office, authentication, algorithms, revocation);
}

/** Applies to each router, and finds nothing to change after. */
function applyAll(): void {
    for (const name of ["internet-01", ...OFFICES.map((office) => office.name)]) {
        // A diff first: the first export after a boot leaves out what the apply's read would then miss (TRAPS.md).
        circuit("diff", name);
        expect(circuit("apply", name, "--confirm").status).toBe(0);
        expect(circuit("diff", name).status).toBe(0);
    }
}

/** What `exec` printed for `commands` on `device`. */
function exec(device: string, ...commands: string[]): string {
    const { status, output } = circuit("exec", device, ...commands);
    expect(status).toBe(0);
    return output;
}

/** Whether office-01's network reaches office-02's, from address to address. When it doesn't, the job's log shows what each router holds. */
function reaches(from: string, to: string): boolean {
    const reached = eventually(() => /received=[1-9]/.test(exec(FIRST.name, `/ping ${to} src-address=${from} count=3`)));
    if (!reached) {
        logTunnels();
        for (const office of OFFICES)
            exec(
                office.name,
                `/ping ${(office === FIRST ? SECOND : FIRST).wan} count=2`,
                "/ip address print",
                "/ip route print",
                '/log print where topics~"ipsec"'
            );
        exec("internet-01", "/ip address print", "/ip route print", "/ip firewall filter print stats");
    }
    return reached;
}

/** The packets internet-01 forwarded that the rule with this description counted, in the firewall of `menu`, `/ip` or `/ipv6`. */
async function counted(description: string, menu = "/ip"): Promise<number> {
    return Number((await onChr(internetChr!, `:put [${menu} firewall filter get [find comment="${description}"] packets]`)).trim());
}

/** Tears down the offices' SAs, so IKE makes them again with what the config now says. */
async function rekey(): Promise<void> {
    for (const office of OFFICES) await onChr(office.chr, "/ip ipsec active-peers kill-connections; /ip ipsec installed-sa flush");
}

/** What each office holds of its tunnel, for the job's log. */
function logTunnels(): void {
    for (const { name } of OFFICES)
        exec(
            name,
            "/ip ipsec export",
            "/ip ipsec active-peers print detail",
            "/ip ipsec installed-sa print detail",
            "/ip ipsec policy print detail"
        );
}

describe.skipIf(!internetChr || !firstChr || !secondChr)("policy-based IPsec between two CHRs", () => {
    /** The runner's web server, which serves the CA's list of revoked certificates. It runs on its own: the tests wait without yielding, so a server of their own would answer nothing. Its log of each request goes to the job's log. */
    let server: ChildProcess | undefined;

    beforeAll(() => {
        write("circuit.ts", `export const lab = circuit({ sites: { lab: { description: "Three CHRs, linked port to port." } } });\n`);
        writeCertificates();
        writeLab("key");
        server = spawn(
            "python3",
            ["-m", "http.server", String(CRL_PORT), "--bind", "127.0.0.1", "--directory", join(folder, "certificates")],
            {
                stdio: "inherit",
            }
        );
    });

    afterAll(() => {
        server?.kill();
        rmSync(folder, { recursive: true, force: true });
    });

    test(
        "two offices with a key both share encrypt what their networks send each other, of both families, and the internet between them sees only ESP",
        async () => {
            applyAll();
            await onChr(internetChr!, "/ip firewall filter reset-counters-all; /ipv6 firewall filter reset-counters-all");

            expect(reaches(FIRST.lan, SECOND.lan)).toBe(true);
            expect(reaches(FIRST.lan6, SECOND.lan6)).toBe(true);
            logTunnels();

            expect(exec(FIRST.name, "/ip ipsec active-peers print detail")).toContain("state=established");
            expect(exec(FIRST.name, "/ip ipsec installed-sa print detail")).toMatch(/enc-algorithm=aes-cbc\s+enc-key-size=256/);
            expect(await counted("ESP")).toBeGreaterThan(0);
            expect(await counted("office-01 in the clear")).toBe(0);
            expect(await counted("office-01 in the clear, IPv6", "/ipv6")).toBe(0);

            // Neither the SAs nor the counters change anything to plan.
            for (const { name } of OFFICES) expect(circuit("diff", name).status).toBe(0);
        },
        TEST_MS
    );

    test(
        "both ends change to AES-GCM without PFS in ESP, to other IKE algorithms, and to no liveness checks, and IKE makes the SAs again with them",
        async () => {
            writeLab("key", ALGORITHMS.changed);
            for (const { name } of OFFICES) {
                expect(circuit("apply", name, "--confirm").status).toBe(0);
                expect(circuit("diff", name).status).toBe(0);
            }
            await rekey();

            expect(reaches(FIRST.lan, SECOND.lan)).toBe(true);
            logTunnels();
            expect(exec(FIRST.name, "/ip ipsec installed-sa print detail")).toMatch(/enc-algorithm=aes-gcm/);
            expect(exec(FIRST.name, "/ip ipsec profile print detail where name=office-02")).toMatch(/dpd-interval=disable-dpd/);
        },
        TEST_MS
    );

    test(
        "both ends change to certificates of one CA, and each takes the other's",
        async () => {
            writeLab("certificates", ALGORITHMS.changed);
            for (const { name } of OFFICES) {
                expect(circuit("apply", name, "--confirm").status).toBe(0);
                expect(circuit("diff", name).status).toBe(0);
            }
            await rekey();

            expect(reaches(FIRST.lan, SECOND.lan)).toBe(true);
            logTunnels();
            expect(exec(FIRST.name, "/ip ipsec active-peers print detail")).toContain('id="CN=office-02"');
        },
        TEST_MS
    );

    test(
        "with the CA's list of revoked certificates, office-01 refuses office-02's revoked certificate, then takes its good one again",
        async () => {
            writeLab("certificates", ALGORITHMS.changed, { crl: true, certificate: REVOKED });
            for (const { name } of OFFICES) {
                expect(circuit("apply", name, "--confirm").status).toBe(0);
                expect(circuit("diff", name).status).toBe(0);
            }
            // The list holds one revoked certificate once office-01 has fetched it.
            expect(eventually(() => /revoked=1\b/.test(exec(FIRST.name, "/certificate crl print detail")))).toBe(true);
            await rekey();

            expect(eventually(() => /can't verify peer's certificate/.test(exec(FIRST.name, '/log print where topics~"ipsec"')))).toBe(
                true
            );
            expect(/received=[1-9]/.test(exec(FIRST.name, `/ping ${SECOND.lan} src-address=${FIRST.lan} count=3`))).toBe(false);
            expect(exec(FIRST.name, "/ip ipsec active-peers print detail")).not.toContain("state=established");
            logTunnels();

            writeLab("certificates", ALGORITHMS.changed, { crl: true });
            expect(circuit("apply", SECOND.name, "--confirm").status).toBe(0);
            expect(circuit("diff", SECOND.name).status).toBe(0);
            await rekey();
            expect(reaches(FIRST.lan, SECOND.lan)).toBe(true);
            expect(exec(FIRST.name, "/ip ipsec active-peers print detail")).toContain('id="CN=office-02"');
            for (const { name } of OFFICES) expect(circuit("diff", name).status).toBe(0);
        },
        TEST_MS
    );

    test(
        "without the tunnel and the certificates in the config, each apply removes their entries and the list, and diff then finds nothing to change",
        () => {
            writeLab();
            for (const { name } of OFFICES) {
                expect(circuit("apply", name, "--confirm").status).toBe(0);
                expect(circuit("diff", name).status).toBe(0);
                expect(exec(name, "/ip ipsec export", "/certificate crl export")).not.toMatch(/^add /m);
                expect(exec(name, "/certificate settings export")).not.toContain("crl-use=yes");
            }
            expect(eventually(() => !/received=[1-9]/.test(exec(FIRST.name, `/ping ${SECOND.lan} src-address=${FIRST.lan} count=2`)))).toBe(
                true
            );
        },
        TEST_MS
    );
});
