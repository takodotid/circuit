// How Circuit logs in over SSH: the connection user's own keys first, then the password, revealed only when no key logged in. Only the
// keys the user takes are offered, and Circuit says which way it logged in.

import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Server, utils } from "ssh2";
import { DeviceChecks } from "../../src/checks/device";
import type { SshPublicKey } from "../../src/config/system";
import { Ssh } from "../../src/transport/ssh";
import { Fixtures } from "../fixtures";

const home = mkdtempSync(join(tmpdir(), "circuit-ssh-login-"));
const saved = { SSH_AUTH_SOCK: process.env.SSH_AUTH_SOCK };
const keyFolder = Ssh.keyFolder;

const mine = utils.generateKeyPairSync("ed25519", { comment: "netops@laptop" });
const other = utils.generateKeyPairSync("ed25519", { comment: "someone else" });

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

    server = new Server({ hostKeys: [utils.generateKeyPairSync("ed25519").private] }, (client) => {
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
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address: AddressInfo | string | null = server.address();
    port = typeof address === "object" && address ? address.port : 0;
    Ssh.report = (message) => reports.push(message);
});

beforeEach(() => {
    tries = [];
    reports = [];
});

afterAll(() => {
    server.close();
    Ssh.report = undefined;
    Ssh.keyFolder = keyFolder;
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
