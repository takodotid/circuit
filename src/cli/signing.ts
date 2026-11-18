// The release workflow signs each release's SHA256SUMS into SHA256SUMS.sig, with the Ed25519 key in the repository secret RELEASE_SIGNING_KEY. Circuit installs a binary only when one of these keys signed SHA256SUMS and the binary matches it. A new key goes here, beside the old one, before releases are signed with it.

import { createPublicKey, verify } from "node:crypto";

export class Signing {
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
