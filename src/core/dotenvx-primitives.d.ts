// The functions Circuit takes from @dotenvx/primitives, which ships no types. Each is as its README describes it.

declare module "@dotenvx/primitives" {
    /** A new secp256k1 keypair, or the one of this private key. Both keys are hex. */
    export function keypair(privateKey?: string): { privateKey: string; publicKey: string };
    /** The public key of a private key. */
    export function derive(privateKey: string): string;
    /** `value` encrypted for `publicKey`, as `encrypted:...`. */
    export function encrypt(publicKey: string, value: string): string;
    /** An `encrypted:...` value decrypted. A plain value comes back as it is. */
    export function decrypt(privateKey: string, value: string): string;
    /** `source` with `key` set to `value`, added at the end when it is not there. Other lines, comments and quotes stay. */
    export function upsert(source: string, key: string, value: string): string;
    /** `source` without any line that sets `key`. */
    export function remove(source: string, key: string): string;
}
