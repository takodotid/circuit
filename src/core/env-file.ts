// A project's `.env`, each value encrypted (as dotenvx does), so it can be committed. Each value is encrypted for the public key at the top of `.env`. The private key that decrypts them is `DOTENV_PRIVATE_KEY`: in the environment, in `.env.keys`, or in `.env` itself as a 1Password reference. Any value, the key too, may be a 1Password reference, `op://vault/item/field`: Circuit reads it with the 1Password CLI when it needs it.

import { decrypt, derive, encrypt, keypair, remove, upsert } from "@dotenvx/primitives";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseEnv } from "node:util";

/** What a value in `.env` is: encrypted, a reference to a password manager, empty, or plain text, which must not be committed. */
export type EnvValueKind = "encrypted" | "1password" | "reference" | "empty" | "not encrypted";

/** The 1Password CLI, `op`. */
export class OnePassword {
    /** Each reference read in this run, so 1Password asks once. */
    private static readonly cache = new Map<string, string>();

    static installed(): boolean {
        return !spawnSync("op", ["--version"], { encoding: "utf8" }).error;
    }

    /** A reference read before in this run, without asking 1Password. */
    static cached(reference: string): string | undefined {
        return OnePassword.cache.get(reference);
    }

    /** The value behind `op://vault/item/field`, read once per run. */
    static read(reference: string, what: string): string {
        const cached = OnePassword.cache.get(reference);
        if (cached !== undefined) return cached;

        const result = spawnSync("op", ["read", "--no-newline", reference], { encoding: "utf8" });
        if (result.error) throw new Error(`${what} is in 1Password, and the 1Password CLI, op, is not installed`);
        if (result.status !== 0)
            throw new Error(`${what}: 1Password could not read ${reference}: ${result.stderr.trim() || `op exited with ${result.status}`}`);

        OnePassword.cache.set(reference, result.stdout);
        return result.stdout;
    }
}

export class EnvFile {
    /** The key at the top of `.env` that encrypts each value. Public: it can only encrypt. */
    static readonly PUBLIC_KEY = "DOTENV_PUBLIC_KEY";
    /** The key that decrypts: in the environment, in `.env.keys`, or in `.env` as a 1Password reference. */
    static readonly PRIVATE_KEY = "DOTENV_PRIVATE_KEY";

    private static readonly ENCRYPTED = "encrypted:";

    readonly path: string;
    readonly keysPath: string;
    private privateKey_: string | undefined;

    constructor(readonly root: string) {
        this.path = join(root, ".env");
        this.keysPath = join(root, ".env.keys");
    }

    static isEncrypted(value: string): boolean {
        return value.startsWith(EnvFile.ENCRYPTED);
    }

    /** What a value is, by its name and how it is written. */
    static kindOf(name: string, value: string): EnvValueKind {
        if (!value.trim()) return "empty";
        if (EnvFile.isEncrypted(value)) return "encrypted";
        if (value.startsWith("op://")) return "1password";
        if (value.startsWith("bw://")) return "reference";
        // The public key and dotenvx's `_PLAIN` names are meant to be read.
        if (name.startsWith(EnvFile.PUBLIC_KEY) || name.endsWith("_PLAIN")) return "reference";

        return "not encrypted";
    }

    /** The names in `.env` text whose value is plain text, which must not be committed. */
    static plaintextIn(source: string): string[] {
        return Object.entries(parseEnv(source) as Record<string, string>)
            .filter(([name, value]) => EnvFile.kindOf(name, value) === "not encrypted")
            .map(([name]) => name);
    }

    exists(): boolean {
        return existsSync(this.path);
    }

    private source(): string {
        return this.exists() ? readFileSync(this.path, "utf8") : "";
    }

    /** Every name and value in `.env`, as written. */
    values(): Record<string, string> {
        return parseEnv(this.source()) as Record<string, string>;
    }

    /** The project's own names: every name but the keys'. */
    names(): string[] {
        return Object.keys(this.values()).filter((name) => name !== EnvFile.PUBLIC_KEY && name !== EnvFile.PRIVATE_KEY);
    }

    plaintext(): string[] {
        return EnvFile.plaintextIn(this.source());
    }

    publicKey(): string | undefined {
        return this.values()[EnvFile.PUBLIC_KEY] || undefined;
    }

    /** Where `DOTENV_PRIVATE_KEY` is written, the first of the environment, `.env.keys` and `.env` that has it, and its value: the key, or a 1Password reference to it. */
    private keySource(): { where: string; value: string } | undefined {
        const fromEnvironment = process.env[EnvFile.PRIVATE_KEY];
        if (fromEnvironment) return { where: `the environment, ${EnvFile.PRIVATE_KEY}`, value: fromEnvironment };

        const fromFile = this.keyFromFile();
        if (fromFile) return { where: ".env.keys", value: fromFile };

        const inEnv = this.values()[EnvFile.PRIVATE_KEY];
        return inEnv ? { where: ".env", value: inEnv } : undefined;
    }

    /** Where the private key comes from, without reading 1Password. Undefined when it is nowhere. */
    keyLocation(): string | undefined {
        return EnvFile.describe(this.keySource());
    }

    private static describe(source: { where: string; value: string } | undefined): string | undefined {
        if (!source) return undefined;
        return source.value.startsWith("op://") ? `1Password, ${source.value} (named in ${source.where})` : source.where;
    }

    private keyFromFile(): string | undefined {
        if (!existsSync(this.keysPath)) return undefined;

        return (parseEnv(readFileSync(this.keysPath, "utf8")) as Record<string, string>)[EnvFile.PRIVATE_KEY] || undefined;
    }

    /** The private key without asking anyone: written out where it is, or read from 1Password before in this run. */
    keyAtHand(): string | undefined {
        if (this.privateKey_) return this.privateKey_;

        const source = this.keySource();
        if (!source) return undefined;
        return source.value.startsWith("op://") ? OnePassword.cached(source.value) : source.value;
    }

    /** The private key, read from 1Password when that is where it points. It must fit the public key in `.env`. */
    privateKey(): string {
        if (this.privateKey_) return this.privateKey_;

        const source = this.keySource();
        if (!source) {
            throw new Error(
                '.env is encrypted, and the key that decrypts it is not here. Put it in .env.keys as DOTENV_PRIVATE_KEY=..., in the environment, or as a 1Password reference in .env: DOTENV_PRIVATE_KEY="op://...". Ask your team for it.'
            );
        }

        const key = source.value.startsWith("op://") ? OnePassword.read(source.value, "The key that decrypts .env") : source.value;

        const publicKey = this.publicKey();
        if (publicKey && derive(key) !== publicKey) {
            throw new Error(
                `The key in ${this.keyLocation()} does not decrypt this .env: it belongs to another .env, or the key was rotated. Ask your team for the current key.`
            );
        }

        this.privateKey_ = key;
        return key;
    }

    /** A value as written in `.env`, decrypted when it is encrypted. */
    decrypt(value: string): string {
        return EnvFile.isEncrypted(value) ? decrypt(this.privateKey(), value) : value;
    }

    /** The value of a name: decrypted, or read from 1Password. */
    reveal(name: string): string {
        const value = this.values()[name];
        if (value === undefined) throw new Error(`${name} is not in .env`);

        return value.startsWith("op://") ? OnePassword.read(value, name) : this.decrypt(value);
    }

    /** Set a name: encrypted, or a 1Password reference as it is. */
    set(name: string, value: string): void {
        const publicKey = this.ensurePublicKey();
        const stored = value.startsWith("op://") ? value : encrypt(publicKey, value);

        writeFileSync(this.path, upsert(this.source(), name, stored));
    }

    /** The public key in `.env`. A `.env` without one gets one: from the private key at hand, or from a new keypair whose private key goes in `.env.keys`. */
    private ensurePublicKey(): string {
        const existing = this.publicKey();
        if (existing) return existing;

        const atHand = this.keyAtHand();
        const pair = atHand ? keypair(atHand) : keypair();
        if (!atHand) EnvFile.writeKeys(this.root, pair.privateKey);

        writeFileSync(this.path, upsert(this.source(), EnvFile.PUBLIC_KEY, pair.publicKey));
        return pair.publicKey;
    }

    /** Remove a name. False when it was not there. */
    remove(name: string): boolean {
        if (!(name in this.values())) return false;

        writeFileSync(this.path, remove(this.source(), name));
        return true;
    }

    /** Encrypt every value written as plain text. Gives back their names. */
    encryptAll(): string[] {
        const publicKey = this.ensurePublicKey();
        const names = this.plaintext();
        let source = this.source();

        for (const name of names) source = upsert(source, name, encrypt(publicKey, this.values()[name]!));

        writeFileSync(this.path, source);
        return names;
    }

    /**
     * A new keypair: every value encrypted again for the new public key, and the old key no longer decrypts `.env`. The new private key goes in `.env.keys`; when the old one was elsewhere, such as in 1Password, the person puts the new one there. Gives back what to tell them.
     *
     * `.env.keys` is written before `.env`, so a key that could not be saved changes nothing.
     */
    rotate(): string {
        const source = this.keySource();
        const old = this.privateKey();
        const next = keypair();
        let text = upsert(this.source(), EnvFile.PUBLIC_KEY, next.publicKey);

        for (const [name, value] of Object.entries(this.values())) {
            if (EnvFile.isEncrypted(value)) text = upsert(text, name, encrypt(next.publicKey, decrypt(old, value)));
        }

        EnvFile.writeKeys(this.root, next.privateKey);
        writeFileSync(this.path, text);
        this.privateKey_ = next.privateKey;

        if (source?.where === ".env.keys" && !source.value.startsWith("op://")) return "The new key is in .env.keys.";
        return `The new key is in .env.keys. Put it in place of the old one (${EnvFile.describe(source)}), then delete .env.keys.`;
    }

    private static writeKeys(root: string, privateKey: string): void {
        writeFileSync(
            join(root, ".env.keys"),
            `# The key that decrypts .env. Never commit it: .gitignore keeps it out of git. Share it with your team through a password manager.\n${EnvFile.PRIVATE_KEY}="${privateKey}"\n`
        );
    }

    /** A new `.env` with a new keypair, its private key in `.env.keys`. */
    static create(root: string): void {
        const pair = keypair();
        EnvFile.writeKeys(root, pair.privateKey);

        writeFileSync(
            join(root, ".env"),
            `# The project's secrets, each one encrypted, so this file is safe to commit. Add or change one with: circuit secret set NAME
# The public key below can only encrypt. The key that decrypts is never committed.
${EnvFile.PUBLIC_KEY}="${pair.publicKey}"
`
        );
    }
}
