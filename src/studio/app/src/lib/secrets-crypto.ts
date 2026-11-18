// Decrypting a secrets file's value in the browser, as src/core/secrets-file.ts encrypts it. The password a person types is used here and never leaves the page.

import { gcm } from "@noble/ciphers/aes.js";
import { scryptAsync } from "@noble/hashes/scrypt.js";

export class SecretsCrypto {
    private static readonly PREFIX = "encrypted:";
    private static readonly VERSION = 1;
    private static readonly SALT_BYTES = 16;
    private static readonly IV_BYTES = 12;
    private static readonly TAG_BYTES = 16;
    private static readonly SCRYPT = { N: 131_072, r: 8, p: 1, dkLen: 32 };

    /** One key per salt, so a file's values open with one scrypt run. */
    private readonly keys = new Map<string, Promise<Uint8Array>>();

    constructor(private readonly password: string) {}

    private static partsOf(value: string) {
        const bytes = Uint8Array.from(atob(value.slice(SecretsCrypto.PREFIX.length)), (char) => char.charCodeAt(0));
        const head = 1 + SecretsCrypto.SALT_BYTES + SecretsCrypto.IV_BYTES;
        if (bytes[0] !== SecretsCrypto.VERSION || bytes.length < head + SecretsCrypto.TAG_BYTES)
            throw new Error("not a value Circuit encrypted");
        return {
            salt: bytes.subarray(1, 1 + SecretsCrypto.SALT_BYTES),
            iv: bytes.subarray(1 + SecretsCrypto.SALT_BYTES, head),
            sealed: bytes.subarray(head),
        };
    }

    private key(salt: Uint8Array): Promise<Uint8Array> {
        const id = [...salt].join(",");
        let key = this.keys.get(id);
        if (!key) this.keys.set(id, (key = scryptAsync(this.password, salt, SecretsCrypto.SCRYPT)));
        return key;
    }

    /** One value, decrypted. Throws when the password does not open it. */
    async decrypt(name: string, value: string): Promise<string> {
        if (!value.startsWith(SecretsCrypto.PREFIX)) return value;

        const { salt, iv, sealed } = SecretsCrypto.partsOf(value);
        const plain = gcm(await this.key(salt), iv, new TextEncoder().encode(name)).decrypt(sealed);
        return new TextDecoder().decode(plain);
    }
}
