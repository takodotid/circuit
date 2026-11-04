// The installers check a release's SHA256SUMS against the release key's signature with ssh-keygen: the signature the release workflow makes is one ssh-keygen takes, and the installers carry every release key.

import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createPrivateKey, generateKeyPairSync } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SshSig } from "../../scripts/sshsig";
import { Signing } from "../../src/cli/signing";

const root = join(import.meta.dir, "..", "..");
const windowsKeygen = join(process.env.WINDIR ?? "C:\\Windows", "System32", "OpenSSH", "ssh-keygen.exe");
const keygen = Bun.which("ssh-keygen") ?? (process.platform === "win32" && existsSync(windowsKeygen) ? windowsKeygen : undefined);

/** An Ed25519 key pair, both halves in PEM. */
function keyPair(): { publicKey: string; privateKey: string } {
    return generateKeyPairSync("ed25519", {
        publicKeyEncoding: { type: "spki", format: "pem" },
        privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
}

test.skipIf(!keygen)(
    "ssh-keygen takes a release's signature, asked as the installers ask it, and refuses a changed SHA256SUMS or another key",
    () => {
        const folder = mkdtempSync(join(tmpdir(), "circuit-sshsig-"));
        const release = keyPair();
        const sums = Buffer.from("0123abcd  circuit-linux-x64\n4567ef01  circuit-windows-x64.exe\n");
        writeFileSync(
            join(folder, "allowed_signers"),
            `circuit-release namespaces="${SshSig.NAMESPACE}" ${SshSig.publicKey(release.publicKey)}\n`
        );

        /** ssh-keygen's exit code for `data` checked against the signature of SHA256SUMS by `privateKey`. */
        const verify = (data: Buffer, privateKey: string) => {
            writeFileSync(join(folder, "SHA256SUMS.sshsig"), SshSig.sign(sums, createPrivateKey(privateKey)));
            const args = ["-Y", "verify", "-f", join(folder, "allowed_signers"), "-I", SshSig.PRINCIPAL, "-n", SshSig.NAMESPACE];
            return spawnSync(keygen!, [...args, "-s", join(folder, "SHA256SUMS.sshsig")], { input: data }).status;
        };

        expect(verify(sums, release.privateKey)).toBe(0);
        expect(verify(Buffer.concat([sums, Buffer.from("x")]), release.privateKey)).not.toBe(0);
        expect(verify(sums, keyPair().privateKey)).not.toBe(0);
        rmSync(folder, { recursive: true, force: true });
    }
);

test("each installer carries every release key, as ssh-keygen reads it", () => {
    for (const installer of ["install", "install.ps1"]) {
        const text = readFileSync(join(root, "docs", "public", installer), "utf8");
        for (const key of Signing.KEYS)
            expect(text).toContain(`${SshSig.PRINCIPAL} namespaces="${SshSig.NAMESPACE}" ${SshSig.publicKey(key)}`);
    }
});
