// The keys, fingerprints, and hashed names here were made by OpenSSH 10.5's ssh-keygen (`-t ed25519`, `-t rsa`, `-l`, and `-H`), so the check is held to what OpenSSH writes and prints.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { KnownHosts } from "../../src/transport/known-hosts";

const ED25519 = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKChVW0KKwfl5tr/aL3zslJSnwwy84oeEYwHXPuhkSmT";
const ED25519_FINGERPRINT = "SHA256:JiA4TR3eOWTrYajJppowRhhBnyWefsh7IYZSuRNttCM";
const OTHER = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIG9XffY/XlPQDuhf76IeSJSoMJk2NgjfsS6/YNI3smOI";
const OTHER_FINGERPRINT = "SHA256:5j+UrRZtWE7kJYDF2fsWZS7A9ZoLdV9aRoUE2ET0FfA";
const RSA =
    "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQC1ohXQukMqRq2+1KKs86nI6zuu6kZlbwVbpDzKvXakFv++MMh1S/C/A3me28RyjaF8PowrCfgCw442qXvUchXFs6NMcIy8OFUZClGVOG9S2W48Ha+vyYgxzkHQDGnMiu1YRuK37lgjNZbqZLrSerwFRbt2uhYPm01uHmr+AINLkV1gbV/aTDdJ8XcsFUZl5LJnlku4w8VwSBGSLCV/WuCn2LTBtqTdZCvvR7NdYyZfJQmO2pnvs0TaewW7aHULVgWQC6hwqhsl6Jb61qSJp1CfBXIc2HerDwqWMaixS58F+ts5u50+LbKI4/GKX4qVjWROGp03iIhLjIO5XCwDUD6b";
const RSA_FINGERPRINT = "SHA256:UjogQ9qVryptAqvt19VBv8G4y0PrdmBdKqhgEfCAv4M";

/** `10.99.0.1` and `[10.99.0.1]:2222`, hashed by `ssh-keygen -H`. */
const HASHED = "|1|S/F3TlyGBd7oe3YSBWB/Whn2XqY=|Ky0vE6i2JiNM/iMSrKBDio/TJ5E=";
const HASHED_PORT = "|1|1/AME0QmxZ7G14IBZzhQhSHV9Lc=|cQvCvXYFZC1nuTt6amj5yCA3oDk=";

const HOST = "10.99.0.1";

/** A key line's key, as the device shows it. */
const blob = (line: string) => Buffer.from(line.split(" ")[1]!, "base64");

let folder = "";
let file = "";

beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), "circuit-known-hosts-"));
    file = join(folder, ".ssh", "known_hosts");
});

afterEach(() => rmSync(folder, { recursive: true, force: true }));

/** A check of `host` against a user file holding `lines`, with what it told. */
function check(lines: string[], host = HOST, port = 22, allowed?: string[]) {
    const told: string[] = [];
    if (lines.length) {
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, `${lines.join("\n")}\n`);
    }
    return { told, ...new KnownHosts(file).check(host, port, allowed, (message) => told.push(message)) };
}

describe("a known host", () => {
    test("a plain line, a hashed one, and a list of names match the key they hold, and nothing is told", () => {
        for (const line of [`${HOST} ${ED25519}`, `${HASHED} ${ED25519}`, `edge-01.example.net,${HOST} ${ED25519} edge-01`]) {
            const known = check([line]);

            expect(known.verify(blob(ED25519))).toBe(true);
            expect(known.told).toEqual([]);
            expect(readFileSync(file, "utf8")).toBe(`${line}\n`);
        }
    });

    test("a port other than 22 is known only as [host]:port, plain or hashed", () => {
        for (const line of [`[${HOST}]:2222 ${ED25519}`, `${HASHED_PORT} ${ED25519}`]) {
            expect(check([line], HOST, 2222).verify(blob(OTHER))).toBe(false);
            // On port 22 the line is another host's, so the key is new.
            expect(check([line]).verify(blob(OTHER))).toBe(true);
        }

        expect(check([`${HOST} ${ED25519}`], HOST, 2222).verify(blob(OTHER))).toBe(true);
    });

    test("* and ? match any host they cover, and ! leaves one out", () => {
        expect(check([`10.99.0.* ${ED25519}`]).verify(blob(OTHER))).toBe(false);
        expect(check([`10.99.0.? ${ED25519}`]).verify(blob(OTHER))).toBe(false);
        expect(check([`10.99.0.?? ${ED25519}`]).verify(blob(OTHER))).toBe(true);
        expect(check([`10.99.0.*,!${HOST} ${ED25519}`]).verify(blob(OTHER))).toBe(true);
        expect(check([`!${HOST},10.99.0.* ${ED25519}`]).verify(blob(OTHER))).toBe(true);
        // A dot is a dot, not any character.
        expect(check([`10.99.0x1 ${ED25519}`]).verify(blob(OTHER))).toBe(true);
    });

    test("names match whatever their case", () => {
        expect(check([`EDGE-01.example.net ${ED25519}`], "edge-01.EXAMPLE.net").verify(blob(OTHER))).toBe(false);
    });

    test("a key that changed is refused with the file, the line, both fingerprints, and the command that removes the old key", () => {
        const known = check(["# Kept by hand", `${HOST} ${ED25519}`]);

        expect(known.verify(blob(OTHER))).toBe(false);
        const refusal = known.explain(new Error("Host denied (verification failed)"));
        expect(refusal.message).toBe(
            `The host key of ${HOST} changed: it shows the ED25519 key ${OTHER_FINGERPRINT}, but ${file} line 2 holds ${ED25519_FINGERPRINT}. Someone may be in the middle, posing as the device to take the password, so Circuit sent nothing. If the device was replaced or reinstalled, remove the old key with \`ssh-keygen -f ${file} -R ${HOST}\`, then connect again.`
        );
        expect((refusal as Error & { level?: string }).level).toBe(KnownHosts.LEVEL);
        expect(known.told).toEqual([]);
    });

    test("on another port, the command quotes [host]:port", () => {
        const known = check([`[${HOST}]:2222 ${ED25519}`], HOST, 2222);

        expect(known.verify(blob(OTHER))).toBe(false);
        expect(known.explain(new Error("Host denied (verification failed)")).message).toContain(
            `The host key of ${HOST} on port 2222 changed:`
        );
        expect(known.explain(new Error("Host denied (verification failed)")).message).toContain(
            `\`ssh-keygen -f ${file} -R '[${HOST}]:2222'\``
        );
    });

    test("a host known by several keys takes any of them", () => {
        const known = check([`${HOST} ${RSA}`, `${HOST} ${ED25519}`]);

        expect(known.verify(blob(ED25519))).toBe(true);
        expect(known.verify(blob(RSA))).toBe(true);
        expect(known.verify(blob(OTHER))).toBe(false);
    });

    test("a key marked @revoked is refused, even where another line knows it", () => {
        const known = check([`${HOST} ${ED25519}`, `@revoked * ${ED25519}`]);

        expect(known.verify(blob(ED25519))).toBe(false);
        expect(known.explain(new Error("Host denied (verification failed)")).message).toBe(
            `${HOST} shows the ED25519 key ${ED25519_FINGERPRINT}, which ${file} line 2 marks @revoked, so Circuit sent nothing. Give the device a new host key.`
        );
    });

    test("a @revoked line alone doesn't make the host known", () => {
        const known = check([`@revoked * ${OTHER}`]);

        expect(known.algorithms).toBeUndefined();
        expect(known.verify(blob(ED25519))).toBe(true);
    });

    test("a @cert-authority line is left out: Circuit doesn't check host certificates", () => {
        const known = check([`@cert-authority * ${ED25519}`]);

        expect(known.verify(blob(OTHER))).toBe(true);
        expect(known.told).toHaveLength(1);
    });

    test("the system's file is read, and never written", () => {
        const system = join(folder, "ssh_known_hosts");
        writeFileSync(system, `${HOST} ${ED25519}\n`);
        const known = new KnownHosts(file, [system]).check(HOST, 22);

        expect(known.verify(blob(ED25519))).toBe(true);
        expect(known.verify(blob(OTHER))).toBe(false);
        expect(known.explain(new Error("Host denied (verification failed)")).message).toContain(`${system} line 1 holds`);
        expect(readFileSync(system, "utf8")).toBe(`${HOST} ${ED25519}\n`);
    });
});

describe("a new host", () => {
    test("its key is added to the user's file, created private, and the user is told once with its fingerprint", () => {
        const known = check([]);

        expect(known.algorithms).toBeUndefined();
        expect(known.verify(blob(ED25519))).toBe(true);
        expect(readFileSync(file, "utf8")).toBe(`${HOST} ${ED25519}\n`);
        expect(known.told).toEqual([`First login to ${HOST}: its ED25519 key ${ED25519_FINGERPRINT} is now in ${file}.`]);
        if (process.platform !== "win32") {
            expect(statSync(file).mode & 0o777).toBe(0o600);
            expect(statSync(join(folder, ".ssh")).mode & 0o777).toBe(0o700);
        }

        const again = new KnownHosts(file).check(HOST, 22);
        expect(again.verify(blob(ED25519))).toBe(true);
        expect(again.verify(blob(OTHER))).toBe(false);
    });

    test("on another port, its key is added as [host]:port, after the file's last line", () => {
        const known = check(["# Kept by hand"]);
        // A file whose last line has no line break, as an editor can leave it.
        writeFileSync(file, "# Kept by hand");

        expect(known.verify(blob(RSA))).toBe(true);
        expect(readFileSync(file, "utf8")).toBe(`# Kept by hand\n${HOST} ${RSA}\n`);
        expect(known.told).toEqual([`First login to ${HOST}: its RSA key ${RSA_FINGERPRINT} is now in ${file}.`]);

        const port = check([], "Edge-01.example.net", 2222);
        expect(port.verify(blob(ED25519))).toBe(true);
        expect(readFileSync(file, "utf8")).toEndWith(`\n[edge-01.example.net]:2222 ${ED25519}\n`);
    });
});

describe("the host key types offered", () => {
    test("only the types known for the host, so a device that also has another type shows a known one", () => {
        expect(check([`${HOST} ${ED25519}`]).algorithms).toEqual(["ssh-ed25519"]);
        expect(check([`${HOST} ${RSA}`, `${HOST} ${ED25519}`]).algorithms).toEqual([
            "ssh-ed25519",
            "rsa-sha2-512",
            "rsa-sha2-256",
            "ssh-rsa",
        ]);
    });

    test("narrowed to those the platform takes", () => {
        expect(check([`${HOST} ${RSA}`], HOST, 22, ["ssh-rsa"]).algorithms).toEqual(["ssh-rsa"]);
        expect(check([], HOST, 22, ["ssh-rsa"]).algorithms).toEqual(["ssh-rsa"]);
    });

    test("none in common is refused before connecting, with the types known and those the platform takes", () => {
        expect(() => check([`${HOST} ${ED25519}`], HOST, 22, ["ssh-rsa"])).toThrow(
            `Circuit can't check the host key of ${HOST}: ${file} line 1 holds its ssh-ed25519 key, and Circuit logs in to it only with a host key of type ssh-rsa. If you trust the device, add its other keys with \`ssh-keyscan ${HOST} >> ${file}\`, then connect again.`
        );
    });

    test("a device that offers none of the known types is refused with the command that removes the old key", () => {
        const known = check([`[${HOST}]:2222 ${ED25519}`], HOST, 2222);
        const refusal = known.explain(new Error("Handshake failed: no matching host key format"));

        expect(refusal.message).toBe(
            `${HOST} on port 2222 offers none of the host key types ${file} line 1 holds for it (ED25519): it may be another device, or someone in the middle, so Circuit sent nothing. If the device was replaced or reinstalled, remove the old key with \`ssh-keygen -f ${file} -R '[${HOST}]:2222'\`, then connect again.`
        );
        expect((refusal as Error & { level?: string }).level).toBe(KnownHosts.LEVEL);

        const other = new Error("Connection lost before handshake");
        expect(known.explain(other)).toBe(other);
    });
});
