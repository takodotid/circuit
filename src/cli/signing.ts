// Signed releases. The release workflow signs each release's SHA256SUMS with Circuit's release key (Ed25519), kept as the repository secret RELEASE_SIGNING_KEY, and attaches the signature, SHA256SUMS.sig. Circuit downloads a binary only when SHA256SUMS carries a signature by one of the keys below and the binary matches it, so a release changed by anyone without the key is refused. A new key is added here, beside the old one, before releases are signed with it.

import { createPublicKey, verify } from "node:crypto";

export class Signing {
    /** The public keys a release may be signed with. */
    static readonly KEYS: readonly string[] = [
        // Made 2026-11-03.
        "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAEVi8tuMkrBMhyI241mBUtTQO7ndoVRjG7LBMQbnOyEw=\n-----END PUBLIC KEY-----\n",
    ];

    /** Whether `signature`, base64, is one of the release keys' over `data`. */
    static verify(data: Buffer, signature: string, keys: readonly string[] = Signing.KEYS): boolean {
        const bytes = Buffer.from(signature.trim(), "base64");
        return keys.some((key) => {
            try {
                return verify(null, data, createPublicKey(key), bytes);
            } catch {
                return false;
            }
        });
    }
}
