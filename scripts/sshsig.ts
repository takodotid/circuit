// A release's SHA256SUMS signed the way `ssh-keygen -Y sign` signs (OpenSSH's PROTOCOL.sshsig), with the same Ed25519 release key as SHA256SUMS.sig. The installers check it with `ssh-keygen -Y verify`, which Windows, macOS and Linux carry, as none of them checks a bare Ed25519 signature with what it has built in.

import { createHash, createPublicKey, type KeyObject, sign } from "node:crypto";

export class SshSig {
    /** What a release signature is for, so it can't stand for a signature made for anything else. */
    static readonly NAMESPACE = "circuit-release";
    /** The name the installers' allowed signers give the release key. */
    static readonly PRINCIPAL = "circuit-release";

    /** An SSH wire-format string: its length, then its bytes. */
    private static string(value: Buffer | string): Buffer {
        const bytes = typeof value === "string" ? Buffer.from(value) : value;
        const length = Buffer.alloc(4);
        length.writeUInt32BE(bytes.length);
        return Buffer.concat([length, bytes]);
    }

    /** An Ed25519 public key, PEM, as ssh-keygen writes one: `ssh-ed25519 AAAA...`. */
    static publicKey(pem: string): string {
        return `ssh-ed25519 ${SshSig.publicBlob(createPublicKey(pem)).toString("base64")}`;
    }

    private static publicBlob(key: KeyObject): Buffer {
        // The SPKI form of an Ed25519 key ends with its 32 bytes.
        const raw = key.export({ type: "spki", format: "der" }).subarray(-32);
        return Buffer.concat([SshSig.string("ssh-ed25519"), SshSig.string(raw)]);
    }

    /** The armored SSH signature of `data` by an Ed25519 private key. */
    static sign(data: Buffer, privateKey: KeyObject): string {
        const hash = createHash("sha512").update(data).digest();
        const signed = Buffer.concat([
            Buffer.from("SSHSIG"),
            SshSig.string(SshSig.NAMESPACE),
            SshSig.string(""),
            SshSig.string("sha512"),
            SshSig.string(hash),
        ]);
        const signature = sign(null, signed, privateKey);

        const blob = Buffer.concat([
            Buffer.from("SSHSIG"),
            Buffer.from([0, 0, 0, 1]),
            SshSig.string(SshSig.publicBlob(createPublicKey(privateKey))),
            SshSig.string(SshSig.NAMESPACE),
            SshSig.string(""),
            SshSig.string("sha512"),
            SshSig.string(Buffer.concat([SshSig.string("ssh-ed25519"), SshSig.string(signature)])),
        ]);
        const lines = blob.toString("base64").match(/.{1,70}/g)!;
        return `-----BEGIN SSH SIGNATURE-----\n${lines.join("\n")}\n-----END SSH SIGNATURE-----\n`;
    }
}
