// Decrypting a secrets file's value in the browser, as Circuit encrypts it: `encrypted:` and the base64 of the version, salt, IV, ciphertext and tag, AES-256-GCM with a key made from the password by scrypt, and the secret's name bound to it. The password a person types is used here and never leaves the page.

import { gcm } from "@noble/ciphers/aes";
import { scryptAsync } from "@noble/hashes/scrypt";

export class SecretsCrypto {
    private static readonly PREFIX = "encrypted:";

    /** One key per salt, so a file's values open with one scrypt run. */
    private readonly keys = new Map<string, Promise<Uint8Array>>();

    constructor(private readonly password: string) {}

    private static partsOf(value: string) {
        const bytes = Uint8Array.from(atob(value.slice(SecretsCrypto.PREFIX.length)), (char) => char.charCodeAt(0));
        if (bytes[0] !== 1 || bytes.length < 1 + 16 + 12 + 16) throw new Error("not a value Circuit encrypted");
        return { salt: bytes.subarray(1, 17), iv: bytes.subarray(17, 29), sealed: bytes.subarray(29) };
    }

    private key(salt: Uint8Array): Promise<Uint8Array> {
        const id = [...salt].join(",");
        let key = this.keys.get(id);
        if (!key) this.keys.set(id, (key = scryptAsync(this.password, salt, { N: 2 ** 17, r: 8, p: 1, dkLen: 32 })));
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
