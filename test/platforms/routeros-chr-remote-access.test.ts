// IPsec remote access on the CHRs of the devices workflow: vpn-01, host-01 behind it, and nat-01, a way from a VRF of vpn-01 to the runner. A laptop is strongSwan on the runner, in a network namespace on vpn-01's ether4, and FreeRADIUS checks its password. No selector holds a management network. Skipped without the CHRs and the namespace.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawn, spawnSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Address } from "../../src/core/address";
import { Ssh } from "../../src/transport/ssh";

/** Each CHR's SSH, as `host:port`. Each has the user `operator`, with the password in CIRCUIT_TEST_CHR_PASSWORD. */
const gatewayChr = process.env.CIRCUIT_TEST_CHR;
const hostChr = process.env.CIRCUIT_TEST_CHR_B;
const natChr = process.env.CIRCUIT_TEST_CHR_C;
const password = process.env.CIRCUIT_TEST_CHR_PASSWORD ?? "";
/** The key vpn-01 and FreeRADIUS share, and the user FreeRADIUS knows, as the workflow set them. */
const radiusSecret = process.env.CHR_RADIUS_SECRET;
const user = process.env.CHR_RA_USER ?? "";
const userPassword = process.env.CHR_RA_PASSWORD ?? "";
/** The network namespace on the runner where the laptop runs, and the tap there that is the first CHR's ether4. */
const namespace = process.env.CHR_RA_NAMESPACE;
const tap = process.env.CHR_RA_TAP;

const repo = join(import.meta.dir, "..", "..");
const folder = realpathSync(mkdtempSync(join(tmpdir(), "circuit-chr-remote-access-")));
/** The laptop's swanctl folder: swanctl.conf, with the certificates and keys in the folders swanctl reads beside it. */
const laptop = join(folder, "laptop");

/** A test applies to two routers, and waits for IKE. */
const TEST_MS = 300_000;
/** How long the laptop waits for IKE, in seconds. */
const IKE_SECONDS = 30;
/** How long charon has to start. */
const START_MS = 5000;
/** The mode of a script charon runs. */
const EXECUTABLE = 0o755;
/** How long RADIUS accounting has to arrive. */
const WAIT_MS = 30_000;
const POLL_MS = 3000;

/** The runner, as vpn-01 reaches it through QEMU's user network: the RADIUS server, and the web server of the CA's list of revoked certificates. nat-01 reaches it at its own .2. */
const RUNNER = "10.0.0.2";
const RUNNER_FROM_NAT = "10.0.2.2";
const CRL_PORT = 8000;
/** vpn-01's address on the internet, where the laptop connects, and the laptop's own. */
const GATEWAY = "192.0.2.1";
const LAPTOP = "192.0.2.2";
/** host-01, in the office network behind vpn-01. */
const HOST = "198.51.100.2";

/** What the remote access gives, before the change and after it, and the RADIUS server that checks users. */
type Offer = { pool: [string, string]; dns?: string[]; selectors: string[]; radius: string; algorithms: string };

const FIRST: Offer = {
    pool: ["203.0.113.10", "203.0.113.20"],
    dns: ["198.51.100.53", "198.51.100.54"],
    selectors: ["198.51.100.0/24"],
    radius: `{ address: "${RUNNER}", secret_key: secret("RADIUS_SECRET") }`,
    algorithms: `ike: { encryption: "aes-256-cbc", integrity: "hmac-sha2-256-128", prf: "hmac-sha2-256", dh_group: 14, lifetime: 28800 },
                esp: { encryption: "aes-256-cbc", integrity: "hmac-sha2-256-128", lifetime: 3600 },`,
};
const CHANGED: Offer = {
    pool: ["203.0.113.100", "203.0.113.120"],
    dns: ["198.51.100.54"],
    selectors: ["198.51.100.0/25"],
    // Through nat-01, in the management VRF.
    radius: `{ address: "${RUNNER_FROM_NAT}", secret_key: secret("RADIUS_SECRET"), source_address: "10.9.0.1", vrf: "management" }`,
    algorithms: `ike: { encryption: "aes-128-cbc", integrity: "hmac-sha2-512-256", prf: "hmac-sha2-512", dh_group: 19, lifetime: 86400 },
                esp: { encryption: "aes-256-gcm", pfs_group: 19, lifetime: 1800 },`,
};
/** The first offer without DNS servers, which the certificates test takes. */
const NO_DNS: Offer = { ...FIRST, dns: undefined };

/** An address in the smallest prefix that holds FIRST's pool, but outside the pool. */
const OUTSIDE_POOL = "203.0.113.25";

/** The laptop's algorithms: both sets above, so it takes whichever vpn-01 offers. */
const IKE_PROPOSALS = "aes256-sha256-prfsha256-modp2048, aes128-sha512-prfsha512-ecp256";
const ESP_PROPOSALS = "aes256-sha256, aes256gcm16-ecp256, aes256gcm16";

/** How users prove who they are. */
type Users = "eap" | "certificates";

/** A user's certificate that the CA revokes, and one of another CA, which vpn-01 doesn't hold. */
const REVOKED = "alice-revoked";
const STRANGER = "mallory";

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
function shell(command: string): { status: number | null; output: string } {
    const run = spawnSync("sh", ["-c", command], { cwd: folder, encoding: "utf8" });
    const output = `${run.stdout}${run.stderr}`;
    console.log(`$ ${command}\n${output}`);
    return { status: run.status, output };
}

/** A command in the laptop's namespace. */
function onLaptop(command: string): { status: number | null; output: string } {
    return shell(`sudo ip netns exec ${namespace} ${command}`);
}

/** A file of the lab project. */
function write(path: string, text: string): void {
    mkdirSync(dirname(join(folder, path)), { recursive: true });
    writeFileSync(join(folder, path), text);
}

/** What `exec` printed for `commands` on `device`. */
function exec(device: string, ...commands: string[]): string {
    const { status, output } = circuit("exec", device, ...commands);
    expect(status).toBe(0);
    return output;
}

/**
 * A CA for the lab, vpn-01's certificate, alice's, a revoked one of alice's, and mallory's of another CA, each as `certificates/<name>.pem` with its key beside it. The CA's list of what it revoked is `certificates/lab-ca.crl`, as RFC 5280 writes one: DER, with the CA's key identifier.
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
    const ca = (name: string, key: string) =>
        `openssl req -x509 -newkey rsa:2048 -nodes -keyout ${key} -out ${name}.pem -days 30 -subj "/CN=${name}" -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign,cRLSign" -addext "subjectKeyIdentifier=hash"`;
    expect(shell(`cd certificates && ${ca("lab-ca", "ca/lab-ca.key")} && ${ca("other-ca", "other-ca.key")}`).status).toBe(0);

    // vpn-01 sends its address as its IKE identity, which a client finds in the certificate (TRAPS.md).
    const names: Record<string, string> = {
        "vpn-gateway": `subjectAltName=IP:${GATEWAY}\nextendedKeyUsage=serverAuth\n`,
        alice: "subjectAltName=email:alice@lab.example\nextendedKeyUsage=clientAuth\n",
        [REVOKED]: "subjectAltName=email:alice@lab.example\nextendedKeyUsage=clientAuth\n",
    };
    for (const [name, extensions] of Object.entries(names)) {
        write(
            `certificates/${name}.ext`,
            `${extensions}keyUsage=digitalSignature\nauthorityKeyIdentifier=keyid\nsubjectKeyIdentifier=hash\n`
        );
        const request = `openssl req -new -newkey rsa:2048 -nodes -keyout ${name}.key -out ${name}.csr -subj "/CN=${name}"`;
        const sign = `openssl ca -batch -notext -config ca/ca.cnf -in ${name}.csr -out ${name}.pem -extfile ${name}.ext`;
        expect(shell(`cd certificates && ${request} && ${sign}`).status).toBe(0);
    }
    write(`certificates/${STRANGER}.ext`, "subjectAltName=email:mallory@lab.example\nkeyUsage=digitalSignature\n");
    const stranger = `openssl req -new -newkey rsa:2048 -nodes -keyout ${STRANGER}.key -out ${STRANGER}.csr -subj "/CN=${STRANGER}" && openssl x509 -req -in ${STRANGER}.csr -CA other-ca.pem -CAkey other-ca.key -CAcreateserial -days 30 -out ${STRANGER}.pem -extfile ${STRANGER}.ext`;
    expect(shell(`cd certificates && ${stranger}`).status).toBe(0);

    const revoke = `openssl ca -config ca/ca.cnf -revoke ${REVOKED}.pem && openssl ca -config ca/ca.cnf -gencrl -out ca/lab-ca.crl.pem && openssl crl -in ca/lab-ca.crl.pem -outform DER -out lab-ca.crl`;
    expect(shell(`cd certificates && ${revoke}`).status).toBe(0);
}

/** vpn-01: the office network behind it, the internet toward the laptop, a management VRF toward nat-01, and, unless `users` is left out, the remote access. It counts the ESP it takes. */
function writeGateway(users?: Users, offer: Offer = FIRST): void {
    const [host, port] = gatewayChr!.split(":");
    const dns = offer.dns ? `dns: [${offer.dns.map((server) => `"${server}"`).join(", ")}],` : "";
    const way = users === "eap" ? `radius: [${offer.radius}],` : `ca_certificate: "lab-ca",`;
    const access = users
        ? `
    services: {
        ipsec_remote_access: {
            staff: {
                description: "Staff laptops",
                local_address: "${GATEWAY}",
                pool: ["${offer.pool[0]}", "${offer.pool[1]}"],
                ${dns}
                traffic_selectors: [${offer.selectors.map((prefix) => `{ local_prefix: "${prefix}" }`).join(", ")}],
                certificate: "vpn-gateway",
                ${way}
                ${offer.algorithms}
            },
        },
    },`
        : "";
    write(
        "sites/lab/vpn-01.ts",
        `import { lab } from "../../circuit";

export default lab.device({
    name: "vpn-01",
    site: "lab",
    platform: "routeros",
    model: "CHR",
    connection: { host: "${host}", port: ${port}, user: "operator" },
    system: {
        users: { operator: { role: "admin", password: secret("OPERATOR_PASSWORD") } },
        certificates: {
            "lab-ca": { certificate_file: "certificates/lab-ca.pem", crl_url: "http://${RUNNER}:${CRL_PORT}/lab-ca.crl" },
            "vpn-gateway": { certificate_file: "certificates/vpn-gateway.pem", private_key: secretFile("certificates/vpn-gateway.key") },
        },
    },
    management: { allow: ["10.0.0.0/24"], ssh: {} },
    interfaces: {
        ethernet: {
            "virtual-1": { description: "Management", addresses: ["10.0.0.1/24"] },
            "virtual-2": { description: "host-01", addresses: ["198.51.100.1/24"] },
            "virtual-3": { description: "nat-01", addresses: ["10.9.0.1/30"], vrf: "management" },
            "virtual-4": { description: "The internet", addresses: ["${GATEWAY}/24"] },
        },
    },
    routing: {
        vrfs: { management: { description: "The way to the RADIUS server through nat-01" } },
        static_routes: [
            // The clients' addresses are on the internet's side: what goes to them is routed there, and leaves encrypted.
            { prefix: "0.0.0.0/0", next_hop: "${LAPTOP}", description: "The internet" },
            { prefix: "10.0.2.0/24", next_hop: "10.9.0.2", vrf: "management", description: "nat-01" },
        ],
    },
    firewall: { filter: { input: { rules: [{ description: "ESP", if: { protocol: "esp" }, then: "accept" }] } } },${access}
});
`
    );
}

/** nat-01, which takes what comes from vpn-01's management VRF to the runner, from its own address. */
function writeNat(): void {
    const [host, port] = natChr!.split(":");
    write(
        "sites/lab/nat-01.ts",
        `import { lab } from "../../circuit";

export default lab.device({
    name: "nat-01",
    site: "lab",
    platform: "routeros",
    model: "CHR",
    connection: { host: "${host}", port: ${port}, user: "operator" },
    system: { users: { operator: { role: "admin", password: secret("OPERATOR_PASSWORD") } } },
    management: { allow: ["10.0.2.0/24"], ssh: {} },
    interfaces: {
        ethernet: {
            "virtual-1": { description: "Management", addresses: ["10.0.2.1/24"] },
            "virtual-2": { description: "vpn-01", addresses: ["10.9.0.2/30"] },
        },
    },
    firewall: { nat: { source: [{ description: "vpn-01 to the runner", if: { src: "10.9.0.0/30", out_interface: "virtual-1" }, then: "masquerade" }] } },
});
`
    );
}

/** host-01, in the office network, with a route back to the clients through vpn-01. */
function writeHost(): void {
    const [host, port] = hostChr!.split(":");
    write(
        "sites/lab/host-01.ts",
        `import { lab } from "../../circuit";

export default lab.device({
    name: "host-01",
    site: "lab",
    platform: "routeros",
    model: "CHR",
    connection: { host: "${host}", port: ${port}, user: "operator" },
    system: { users: { operator: { role: "admin", password: secret("OPERATOR_PASSWORD") } } },
    management: { allow: ["10.0.1.0/24"], ssh: {} },
    interfaces: {
        ethernet: {
            "virtual-1": { description: "Management", addresses: ["10.0.1.1/24"] },
            "virtual-2": { description: "vpn-01", addresses: ["${HOST}/24"] },
        },
    },
    routing: { static_routes: [{ prefix: "203.0.113.0/24", next_hop: "198.51.100.1", description: "Remote access clients" }] },
});
`
    );
}

/**
 * The settings of the laptop's charon, among strongSwan's: its log, and what it runs in place of resolvconf(8), which strongSwan 6 takes whenever the system has it. The stand-in keeps the DNS servers it gets in a file of the lab, so the runner's own DNS stays as it is.
 */
function writeCharonSettings(): void {
    write("laptop/resolv.conf", "");
    write("laptop/resolvconf", `#!/bin/sh\nif [ "$1" = "-a" ]; then cat > ${laptop}/resolv.conf; else : > ${laptop}/resolv.conf; fi\n`);
    chmodSync(join(laptop, "resolvconf"), EXECUTABLE);
    write(
        "laptop/zz-circuit.conf",
        `charon {
    plugins {
        resolve {
            resolvconf {
                path = ${laptop}/resolvconf
            }
        }
    }
    filelog {
        circuit {
            path = ${laptop}/charon.log
            default = 1
            ike = 2
            cfg = 2
        }
    }
}
`
    );
    expect(shell(`sudo cp ${laptop}/zz-circuit.conf /etc/strongswan.d/`).status).toBe(0);
}

/**
 * The laptop's swanctl.conf: one connection for each way a user logs in. Each asks for an address, and trusts the lab's CA for vpn-01's certificate, whatever identity vpn-01 sends (TRAPS.md). Each asks for all traffic, `0.0.0.0/0`, but `outside`, which asks for the office alone, from an address outside the pool. The EAP password is `secret`.
 */
function writeLaptop(secret: string): void {
    for (const folderName of ["x509", "x509ca", "private"]) mkdirSync(join(laptop, folderName), { recursive: true });
    const certificates = join(folder, "certificates");
    copyFileSync(join(certificates, "lab-ca.pem"), join(laptop, "x509ca", "lab-ca.pem"));
    for (const name of ["alice", REVOKED, STRANGER]) {
        copyFileSync(join(certificates, `${name}.pem`), join(laptop, "x509", `${name}.pem`));
        copyFileSync(join(certificates, `${name}.key`), join(laptop, "private", `${name}.key`));
    }

    const connection = (name: string, local: string, child = "remote_ts = 0.0.0.0/0") => `
    ${name} {
        version = 2
        remote_addrs = ${GATEWAY}
        vips = 0.0.0.0
        proposals = ${IKE_PROPOSALS}
        local {
            ${local}
        }
        remote {
            auth = pubkey
            cacerts = lab-ca.pem
        }
        children {
            ${name} {
                ${child}
                esp_proposals = ${ESP_PROPOSALS}
            }
        }
    }`;
    const eap = `auth = eap-mschapv2\n            id = ${user}`;
    // A user's identity is the email address of the certificate: RouterOS refuses its subject, which the certificate's email doesn't match (TRAPS.md).
    const byCertificate = (name: string, email: string) => `auth = pubkey\n            certs = ${name}.pem\n            id = ${email}`;
    const users: [string, string][] = [
        ["alice", "alice@lab.example"],
        [REVOKED, "alice@lab.example"],
        [STRANGER, "mallory@lab.example"],
    ];
    write(
        "laptop/swanctl.conf",
        `connections {${connection("eap", eap)}${connection("outside", eap, `local_ts = ${OUTSIDE_POOL}/32\n                remote_ts = 198.51.100.0/24`)}${users
            .map(([name, email]) => connection(name, byCertificate(name, email)))
            .join("")}
}
secrets {
    eap-user {
        id = ${user}
        secret = "${secret}"
    }
}
`
    );
    expect(shell(`sudo swanctl --load-creds --clear --file ${laptop}/swanctl.conf`).status).toBe(0);
    expect(shell(`sudo swanctl --load-conns --file ${laptop}/swanctl.conf`).status).toBe(0);
}

/** Starts the connection `name`, and whether IKE set it up with its ESP SA. When it didn't, the job's log shows why vpn-01 refused it. */
function logIn(name: string): boolean {
    const up = shell(`sudo swanctl --initiate --ike ${name} --child ${name} --timeout ${IKE_SECONDS}`).status === 0;
    if (!up) exec("vpn-01", '/log print where topics~"ipsec" or topics~"radius"');
    return up;
}

/** Ends the laptop's IKE SAs. */
function logOut(): void {
    for (const name of ["eap", "outside", "alice", REVOKED, STRANGER]) shell(`sudo swanctl --terminate --ike ${name} --timeout 10`);
}

/** The laptop's SAs, as swanctl lists them. */
function sas(): string {
    return shell("sudo swanctl --list-sas").output;
}

/** The address the laptop holds from the pool, as swanctl shows it beside its own: `[203.0.113.20]`. */
function laptopAddress(): string | undefined {
    return /@ 192\.0\.2\.2\[\d+\] \[([\d.]+)\]/.exec(sas())?.[1];
}

/** Whether `address` is in `pool`. */
function inPool(address: string | undefined, [first, last]: [string, string]): boolean {
    const value = address === undefined ? null : Address.toNumber(address);
    return value !== null && value >= Address.toNumber(first)! && value <= Address.toNumber(last)!;
}

/** The DNS servers the laptop took, each once, in order. */
function dnsServers(): string[] {
    const servers = [...readFileSync(join(laptop, "resolv.conf"), "utf8").matchAll(/^nameserver (\S+)/gm)].map((match) => match[1]!);
    return [...new Set(servers)].sort();
}

/** The ESP packets vpn-01 took, which its input rule counted. */
async function espCounted(): Promise<number> {
    const [host, port] = gatewayChr!.split(":");
    const client = await Ssh.connect({ host: host!, port: Number(port), user: "operator+ct", password: () => password });
    try {
        const output = await Ssh.exec(client, ':put [/ip firewall filter get [find comment="ESP"] packets]');
        console.log(`$ vpn-01 ESP packets\n${output}`);
        return Number(output.trim());
    } finally {
        client.end();
    }
}

/** Whether the laptop reaches host-01, through the tunnel: its namespace has no other route there. */
function reachesHost(): boolean {
    return onLaptop(`ping -c 3 -W 2 ${HOST}`).status === 0;
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

/** The accounting FreeRADIUS keeps, record by record. */
function accounting(): string[] {
    return shell("sudo sh -c 'cat /var/log/freeradius/radacct/*/detail-*'").output.split(/\n\s*\n/);
}

/** Applies vpn-01, and finds nothing to change after. */
function applyGateway(): void {
    expect(circuit("apply", "vpn-01", "--confirm").status).toBe(0);
    expect(circuit("diff", "vpn-01").status).toBe(0);
}

describe.skipIf(!gatewayChr || !hostChr || !natChr || !namespace || !tap)(
    "IPsec remote access on a CHR, with strongSwan on the runner",
    () => {
        /** The runner's web server, which serves the CA's list of revoked certificates, and the laptop's charon. Each runs on its own: the tests wait without yielding. */
        let server: ChildProcess | undefined;
        let charon: ChildProcess | undefined;

        beforeAll(() => {
            write("circuit.ts", `export const lab = circuit({ sites: { lab: { description: "Three CHRs, linked port to port." } } });\n`);
            writeCertificates();
            writeGateway();
            writeHost();
            writeNat();
            writeCharonSettings();
            server = spawn(
                "python3",
                ["-m", "http.server", String(CRL_PORT), "--bind", "127.0.0.1", "--directory", join(folder, "certificates")],
                { stdio: "inherit" }
            );

            expect(onLaptop("ip link set lo up").status).toBe(0);
            expect(onLaptop(`ip link set ${tap} up`).status).toBe(0);
            expect(onLaptop(`ip address add ${LAPTOP}/24 dev ${tap}`).status).toBe(0);
            charon = spawn("sudo", ["ip", "netns", "exec", namespace!, "/usr/lib/ipsec/charon"], { stdio: "inherit" });
            Bun.sleepSync(START_MS);
            writeLaptop(userPassword);
        }, TEST_MS);

        afterAll(() => {
            shell(`cat ${laptop}/charon.log`);
            charon?.kill();
            shell("sudo pkill -f /usr/lib/ipsec/charon");
            server?.kill();
            rmSync(folder, { recursive: true, force: true });
        });

        test(
            "a laptop logs in with EAP, which FreeRADIUS checks, takes an address from the pool and the DNS servers, and reaches host-01 encrypted",
            async () => {
                writeGateway("eap");
                for (const name of ["vpn-01", "host-01", "nat-01"]) {
                    // A diff first: the first export after a boot leaves out what the apply's read would then miss (TRAPS.md).
                    circuit("diff", name);
                    expect(circuit("apply", name, "--confirm").status).toBe(0);
                    expect(circuit("diff", name).status).toBe(0);
                }
                const before = await espCounted();

                expect(logIn("eap")).toBe(true);
                const address = laptopAddress();
                expect(inPool(address, FIRST.pool)).toBe(true);
                // The laptop asked for all its traffic, and got the office network alone.
                expect(sas()).toMatch(/remote 198\.51\.100\.0\/24\n/);
                expect(dnsServers()).toEqual(FIRST.dns!);
                expect(reachesHost()).toBe(true);
                expect(await espCounted()).toBeGreaterThan(before);

                // vpn-01 made the laptop's policy from the template, and none holds a management network.
                const policies = exec("vpn-01", "/ip ipsec policy print detail", "/ip ipsec active-peers print detail");
                expect(policies).toContain(`dst-address=${address}/32`);
                expect(policies).not.toMatch(/(src|dst)-address=10\./);
                expect(circuit("diff", "vpn-01").status).toBe(0);
                logOut();

                // FreeRADIUS has the session's accounting, with the address the laptop held.
                const stopped = (record: string) => record.includes("Acct-Status-Type = Stop") && record.includes(`User-Name = "${user}"`);
                expect(eventually(() => accounting().some(stopped))).toBe(true);
                expect(accounting().find(stopped)).toContain(`Framed-IP-Address = ${address}`);
            },
            TEST_MS
        );

        test(
            "a wrong password is refused, and so is a laptop that asks for an address outside the pool as its own",
            () => {
                writeLaptop(`${userPassword}-wrong`);
                expect(logIn("eap")).toBe(false);
                expect(laptopAddress()).toBeUndefined();
                expect(reachesHost()).toBe(false);
                logOut();

                writeLaptop(userPassword);
                expect(logIn("outside")).toBe(false);
                expect(sas()).not.toContain(`local  ${OUTSIDE_POOL}/32`);
                expect(exec("vpn-01", "/ip ipsec policy print detail")).not.toContain(OUTSIDE_POOL);
                logOut();
            },
            TEST_MS
        );

        test(
            "another pool, DNS server, selector, algorithms, and a RADIUS server in a VRF are set in place, and the laptop takes them when it logs in again",
            () => {
                writeGateway("eap", CHANGED);
                applyGateway();

                expect(logIn("eap")).toBe(true);
                expect(inPool(laptopAddress(), CHANGED.pool)).toBe(true);
                expect(sas()).toMatch(/remote 198\.51\.100\.0\/25\n/);
                expect(dnsServers()).toEqual(CHANGED.dns!);
                expect(reachesHost()).toBe(true);
                expect(exec("vpn-01", "/ip ipsec installed-sa print detail")).toMatch(/enc-algorithm=aes-gcm/);
                logOut();
            },
            TEST_MS
        );

        test(
            "with certificates, alice's logs in, without DNS servers, and a revoked one and one of another CA are refused",
            () => {
                writeGateway("certificates", NO_DNS);
                applyGateway();
                // vpn-01 holds the CA's list, with the one certificate it revoked.
                expect(exec("vpn-01", "/certificate crl print detail")).toMatch(/revoked=1\b/);

                expect(logIn("alice")).toBe(true);
                expect(inPool(laptopAddress(), NO_DNS.pool)).toBe(true);
                expect(dnsServers()).toEqual([]);
                expect(reachesHost()).toBe(true);
                expect(exec("vpn-01", "/ip ipsec active-peers print detail")).toContain("alice@lab.example");
                logOut();

                for (const refused of [REVOKED, STRANGER]) {
                    expect(logIn(refused)).toBe(false);
                    expect(laptopAddress()).toBeUndefined();
                    logOut();
                }
                expect(circuit("diff", "vpn-01").status).toBe(0);
            },
            TEST_MS
        );

        test(
            "without the remote access in the config, the apply removes its entries, and the laptop can't log in",
            () => {
                writeGateway();
                applyGateway();
                expect(exec("vpn-01", "/ip ipsec export", "/ip pool export", "/radius export")).not.toMatch(/^add /m);
                expect(logIn("alice")).toBe(false);
                logOut();
            },
            TEST_MS
        );
    }
);
