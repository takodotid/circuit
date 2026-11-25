import { afterAll, beforeAll, beforeEach, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Server, utils } from "ssh2";
import { DeviceChecks } from "../../src/checks/device";
import type { SshPublicKey } from "../../src/config/system";
import { Secrets } from "../../src/core/secrets";
import { SerialConsole } from "../../src/transport/console";
import { KnownHosts } from "../../src/transport/known-hosts";
import { Ssh } from "../../src/transport/ssh";
import { Fixtures } from "../fixtures";

const home = mkdtempSync(join(tmpdir(), "circuit-ssh-login-"));
const knownHosts = join(home, ".ssh", "known_hosts");
const saved = { SSH_AUTH_SOCK: process.env.SSH_AUTH_SOCK };
const keyFolder = Ssh.keyFolder;
const knownHostsFiles = KnownHosts.files;

const mine = utils.generateKeyPairSync("ed25519", { comment: "netops@laptop" });
const other = utils.generateKeyPairSync("ed25519", { comment: "someone else" });
/** The fake device's own host key. */
const device = utils.generateKeyPairSync("ed25519");

/** A public key line's fingerprint, as OpenSSH prints it. */
const fingerprint = (line: string) => KnownHosts.fingerprint(Buffer.from(Ssh.blob(line), "base64"));

/** What the device accepts, and every way it was offered. */
let accepted = "";
let tries: string[] = [];
let reports: string[] = [];
let server: Server;
let port = 0;

beforeAll(async () => {
    mkdirSync(join(home, ".ssh"));
    writeFileSync(join(home, ".ssh", "id_ed25519"), mine.private);
    writeFileSync(join(home, ".ssh", "id_ed25519.pub"), mine.public);
    // A home of its own, and an agent that isn't there, so the test never reaches the machine's own keys.
    Ssh.keyFolder = () => join(home, ".ssh");
    process.env.SSH_AUTH_SOCK = join(home, "no-agent");

    server = new Server({ hostKeys: [device.private] }, (client) => {
        client.on("authentication", (context) => {
            if (context.method === "publickey") {
                const blob = context.key.data.toString("base64");
                tries.push(`key ${blob === Ssh.blob(mine.public) ? "mine" : "other"}`);
                if (blob === accepted && !context.signature) return context.accept();
                if (blob === accepted && context.signature) {
                    const key = utils.parseKey(mine.public);
                    if (!(key instanceof Error) && context.blob && key.verify(context.blob, context.signature, context.hashAlgo))
                        return context.accept();
                }
                return context.reject(["publickey", "password"]);
            }
            if (context.method === "password") {
                tries.push("password");
                return context.password === "lab-pass" ? context.accept() : context.reject();
            }
            context.reject(["publickey", "password"]);
        });
        client.on("ready", () => client.end());
        // A client that refuses the host key ends the connection, which the server takes as an error.
        client.on("error", () => {});
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address: AddressInfo | string | null = server.address();
    port = typeof address === "object" && address ? address.port : 0;
    Ssh.report = (message) => reports.push(message);
    KnownHosts.files = () => new KnownHosts(knownHosts);
});

beforeEach(() => {
    tries = [];
    reports = [];
    // The device's host key is known, under each name the tests reach it by.
    const key = `ssh-ed25519 ${Ssh.blob(device.public)}`;
    writeFileSync(knownHosts, `[127.0.0.1]:${port} ${key}\n[localhost]:${port} ${key}\n`);
});

afterAll(() => {
    server.close();
    Ssh.report = undefined;
    Ssh.keyFolder = keyFolder;
    KnownHosts.files = knownHostsFiles;
    for (const [name, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
    }
    rmSync(home, { recursive: true, force: true });
});

/** Log in once, counting how often the password was revealed. */
async function login(keys: string[], host = "127.0.0.1") {
    let revealed = 0;
    const client = await Ssh.connect({
        host,
        port,
        user: "netops",
        keys,
        password: () => {
            revealed++;
            return "lab-pass";
        },
    });
    client.end();
    return revealed;
}

test("a key the user takes logs in, and the password is never revealed", async () => {
    accepted = Ssh.blob(mine.public);

    expect(await login([mine.public])).toBe(0);
    expect(tries).toEqual(["key mine", "key mine"]);
    expect(reports).toEqual(["Logged in to 127.0.0.1 with ~/.ssh/id_ed25519."]);
});

test("a key the device refuses falls back to the password, and Circuit says so", async () => {
    accepted = "";

    expect(await login([mine.public], "localhost")).toBe(1);
    expect(tries).toEqual(["key mine", "password"]);
    expect(reports).toEqual(["Logged in to localhost with the password: it refused ~/.ssh/id_ed25519. It may not have the key yet."]);
});

test("a key the user doesn't take is never offered", async () => {
    accepted = Ssh.blob(mine.public);

    expect(await login([other.public])).toBe(1);
    expect(tries).toEqual(["password"]);
    expect(reports).toEqual(["Logged in to 127.0.0.1 with the password: none of the user's ssh_keys is in an SSH agent or ~/.ssh here."]);

    expect(await login([])).toBe(1);
    expect(tries).toEqual(["password", "password"]);
});

test("a proof login the device refuses is not tried again, since a device may lock the account", async () => {
    accepted = "";
    const proof = Ssh.retrying(() => Ssh.connect({ host: "127.0.0.1", port, user: "netops", password: () => "wrong" }));

    await expect(proof).rejects.toThrow("All configured authentication methods failed");
    expect(tries).toEqual(["password"]);
});

test("a first login adds the device's host key to known_hosts, private, says so once, and the next login checks it", async () => {
    accepted = Ssh.blob(mine.public);
    rmSync(knownHosts);
    const first = `First login to 127.0.0.1 on port ${port}: its ED25519 key ${fingerprint(device.public)} is now in ${knownHosts}.`;

    expect(await login([mine.public])).toBe(0);
    expect(reports).toContain(first);
    expect(readFileSync(knownHosts, "utf8")).toBe(`[127.0.0.1]:${port} ssh-ed25519 ${Ssh.blob(device.public)}\n`);
    if (process.platform !== "win32") expect(statSync(knownHosts).mode & 0o777).toBe(0o600);

    expect(await login([mine.public])).toBe(0);
    expect(reports.filter((report) => report.startsWith("First login"))).toEqual([first]);
});

test("a device whose host key changed is refused, never tried again, before any password or key is sent", async () => {
    accepted = Ssh.blob(mine.public);
    writeFileSync(knownHosts, `# Kept by hand\n[127.0.0.1]:${port} ssh-ed25519 ${Ssh.blob(other.public)}\n`);
    let revealed = 0;

    const password = () => {
        revealed++;
        return "lab-pass";
    };

    const refused = Ssh.retrying(() => Ssh.connect({ host: "127.0.0.1", port, user: "netops", keys: [mine.public], password }));

    await expect(refused).rejects.toThrow(
        `The host key of 127.0.0.1 on port ${port} changed: it shows the ED25519 key ${fingerprint(device.public)}, but ${knownHosts} line 2 holds ${fingerprint(other.public)}. Someone may be in the middle, posing as the device to take the password, so Circuit sent nothing. If the device was replaced or reinstalled, remove the old key with \`ssh-keygen -f ${knownHosts} -R '[127.0.0.1]:${port}'\`, then connect again.`
    );
    expect(revealed).toBe(0);
    expect(tries).toEqual([]);
});

test("a console's jump host whose host key changed is refused before its password is sent", async () => {
    writeFileSync(knownHosts, `[127.0.0.1]:${port} ssh-ed25519 ${Ssh.blob(other.public)}\n`);
    const reveal = spyOn(Secrets, "reveal").mockReturnValue("lab-pass");

    try {
        const opening = SerialConsole.open({
            jump: { host: "127.0.0.1", port, user: "netops", password: { secret: "JUMP_PASSWORD" } },
            port: "/dev/ttyUSB0",
            baud: 9600,
        });

        await expect(opening).rejects.toThrow(`The host key of 127.0.0.1 on port ${port} changed`);
        expect(tries).toEqual([]);
    } finally {
        reveal.mockRestore();
    }
});

test("a host known only by a key type the platform doesn't take is refused before connecting", async () => {
    // VRP takes only ssh-rsa host keys, and this host's known key is ED25519.
    const refused = Ssh.connect({ host: "127.0.0.1", port, user: "netops", password: () => "lab-pass", hostKeys: ["ssh-rsa"] });

    await expect(refused).rejects.toThrow(
        `Circuit can't check the host key of 127.0.0.1 on port ${port}: ${knownHosts} line 1 holds its ssh-ed25519 key, and Circuit logs in to it only with a host key of type ssh-rsa.`
    );
    expect(tries).toEqual([]);
});

test("an SSH key is one public key line, never a private key", () => {
    const router = Fixtures.device("platforms--example-router");
    const admin = Object.values(router.system?.users ?? {})[0];
    if (!admin) throw new Error("the example router has no user");

    const keysOf = (ssh_keys: string[]) =>
        DeviceChecks.run({ ...router, system: { ...router.system, users: { admin: { ...admin, ssh_keys: ssh_keys as SshPublicKey[] } } } })
            .map((finding) => finding.message)
            .filter((message) => message.includes("ssh_keys"));

    expect(keysOf([mine.public, other.public.trim()])).toEqual([]);
    expect(keysOf([mine.private, "ssh-ed25519 AAAA laptop"])).toEqual([
        "system.users.admin.ssh_keys[0] is a private key: write the public key, the line in the .pub file",
        'system.users.admin.ssh_keys[1] is not a public key line: copy the whole line of the .pub file, such as "ssh-ed25519 AAAAC3Nza... alice@laptop"',
    ]);
});
