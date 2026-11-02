// Decrypting a value of `.env` in the browser, as dotenvx encrypts it: `encrypted:` and the base64 of an ECIES message for the network's secp256k1 key. The key a person types is used here and never leaves the page.

import { decrypt, PrivateKey } from "eciesjs";

export class EnvCrypto {
    private static readonly PREFIX = "encrypted:";

    private static bytesOf(hex: string): Uint8Array {
        const clean = hex.trim().replace(/^0x/, "");
        if (!/^[0-9a-fA-F]{64}$/.test(clean)) throw new Error("A private key is 64 hex characters.");
        return Uint8Array.from(clean.match(/../g)!, (pair) => parseInt(pair, 16));
    }

    private static hexOf(bytes: Uint8Array): string {
        return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    }

    /** Whether a private key opens `.env`: its public key is the one `.env` names. */
    static fits(privateKey: string, publicKey: string): boolean {
        return EnvCrypto.hexOf(new PrivateKey(EnvCrypto.bytesOf(privateKey)).publicKey.toBytes(true)) === publicKey.toLowerCase();
    }

    /** One value, decrypted. */
    static decrypt(privateKey: string, value: string): string {
        if (!value.startsWith(EnvCrypto.PREFIX)) return value;

        const message = Uint8Array.from(atob(value.slice(EnvCrypto.PREFIX.length)), (char) => char.charCodeAt(0));
        return new TextDecoder().decode(decrypt(EnvCrypto.bytesOf(privateKey), message));
    }
}
