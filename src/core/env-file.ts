// A project's `.env`, encrypted the way dotenvx encrypts it, so it can be committed. Each value is encrypted for the public key at the top of `.env`. The private key that decrypts them is never committed: it is in `.env.keys`, in the environment as `DOTENV_PRIVATE_KEY`, or in 1Password, where `CIRCUIT_ENV_KEY` in `.env` points. A value may also be a 1Password reference, `op://vault/item/field`, kept as it is.

import { decrypt, derive, encrypt, keypair, remove, upsert } from "@dotenvx/primitives";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseEnv } from "node:util";

/** What a value in `.env` is: encrypted, a reference to a password manager, empty, or plain text, which must not be committed. */
export type EnvValueKind = "encrypted" | "1password" | "reference" | "empty" | "not encrypted";

/** Where the private key that decrypts `.env` is kept. */
export type KeyStore = { kind: "file" } | { kind: "1password"; vault: string; title: string };

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

    /** The vaults this person can write to. */
    static vaults(): string[] {
        const result = spawnSync("op", ["vault", "list", "--format=json"], { encoding: "utf8" });
        if (result.status !== 0) throw new Error(`1Password could not list your vaults: ${result.stderr.trim()}`);

        return (JSON.parse(result.stdout) as { name: string }[]).map((vault) => vault.name);
    }

    /** Save a new password item, and give back its reference. */
    static create(vault: string, title: string, value: string): string {
        const result = spawnSync(
            "op",
            ["item", "create", "--category=password", `--vault=${vault}`, `--title=${title}`, `password=${value}`],
            {
                encoding: "utf8",
            }
        );
        if (result.status !== 0) throw new Error(`1Password could not save ${title} in ${vault}: ${result.stderr.trim()}`);

        return `op://${vault}/${title}/password`;
    }

    /** Change the value a reference points at. */
    static write(reference: string, value: string): void {
        const parts = reference.slice("op://".length).split("/");
        if (parts.length < 3) throw new Error(`${reference} is not a 1Password reference such as op://vault/item/field`);

        const [vault, item, ...field] = parts as [string, string, ...string[]];
        const result = spawnSync("op", ["item", "edit", item, `--vault=${vault}`, `${field.join(".")}=${value}`], { encoding: "utf8" });
        if (result.status !== 0) throw new Error(`1Password could not change ${reference}: ${result.stderr.trim()}`);

        OnePassword.cache.set(reference, value);
    }
}

export class EnvFile {
    /** The key at the top of `.env` that encrypts each value. Public: it can only encrypt. */
    static readonly PUBLIC_KEY = "DOTENV_PUBLIC_KEY";
    /** The key that decrypts, in `.env.keys` or in the environment. */
    static readonly PRIVATE_KEY = "DOTENV_PRIVATE_KEY";
    /** In `.env`: where in 1Password the private key is, when it is kept there. */
    static readonly KEY_REFERENCE = "CIRCUIT_ENV_KEY";

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
        return Object.keys(this.values()).filter((name) => name !== EnvFile.PUBLIC_KEY && name !== EnvFile.KEY_REFERENCE);
    }

    plaintext(): string[] {
        return EnvFile.plaintextIn(this.source());
    }

    publicKey(): string | undefined {
        return this.values()[EnvFile.PUBLIC_KEY] || undefined;
    }

    /** Where the private key comes from, without reading 1Password. Undefined when it is nowhere. */
    keyLocation(): string | undefined {
        if (process.env[EnvFile.PRIVATE_KEY]) return `the environment, ${EnvFile.PRIVATE_KEY}`;
        if (this.keyFromFile()) return ".env.keys";

        const reference = this.values()[EnvFile.KEY_REFERENCE];
        return reference ? `1Password, ${reference}` : undefined;
    }

    private keyFromFile(): string | undefined {
        if (!existsSync(this.keysPath)) return undefined;

        return (parseEnv(readFileSync(this.keysPath, "utf8")) as Record<string, string>)[EnvFile.PRIVATE_KEY] || undefined;
    }

    /** The private key from the environment or `.env.keys`, or one read before in this run: never by asking 1Password. */
    keyAtHand(): string | undefined {
        return this.privateKey_ ?? (process.env[EnvFile.PRIVATE_KEY] || this.keyFromFile());
    }

    /** The private key, from the environment, `.env.keys` or 1Password. It must fit the public key in `.env`. */
    privateKey(): string {
        if (this.privateKey_) return this.privateKey_;

        const reference = this.values()[EnvFile.KEY_REFERENCE];
        const key = this.keyAtHand() ?? (reference ? OnePassword.read(reference, "The key that decrypts .env") : undefined);

        if (!key) {
            throw new Error(
                ".env is encrypted, and the key that decrypts it is not here. Put it in .env.keys as DOTENV_PRIVATE_KEY=..., or in the environment. Ask your team for it."
            );
        }

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
     * A new keypair: every value encrypted again for the new public key, and the new private key put where the old one was. The old key no longer decrypts `.env`. Gives back where the new key is.
     *
     * `.env` is written last, from a copy made first, so a key that could not be saved changes nothing.
     */
    rotate(): string {
        if (process.env[EnvFile.PRIVATE_KEY] && !this.keyFromFile()) {
            throw new Error(
                "The key comes from DOTENV_PRIVATE_KEY in the environment. Rotate it on a machine that has .env.keys, or where 1Password keeps it."
            );
        }

        const old = this.privateKey();
        const next = keypair();
        let source = upsert(this.source(), EnvFile.PUBLIC_KEY, next.publicKey);

        for (const [name, value] of Object.entries(this.values())) {
            if (EnvFile.isEncrypted(value)) source = upsert(source, name, encrypt(next.publicKey, decrypt(old, value)));
        }

        const staged = `${this.path}.rotating`;
        writeFileSync(staged, source);

        const reference = this.values()[EnvFile.KEY_REFERENCE];
        const inOnePassword = Boolean(reference) && !this.keyFromFile();

        try {
            if (inOnePassword) OnePassword.write(reference!, next.privateKey);
            else EnvFile.writeKeys(this.root, next.privateKey);
        } catch (error) {
            rmSync(staged, { force: true });
            throw error;
        }

        renameSync(staged, this.path);
        this.privateKey_ = next.privateKey;

        return inOnePassword ? `1Password, ${reference}` : ".env.keys";
    }

    /** Move the key from `.env.keys` into a new 1Password item, and point `.env` at it. `.env.keys` goes only once 1Password gives the key back. Gives back the reference. */
    moveKeyToOnePassword(vault: string, title: string): string {
        if (!this.keyFromFile()) throw new Error("There is no .env.keys here to move. circuit secret key says where the key is.");

        const key = this.privateKey();
        const reference = OnePassword.create(vault, title, key);
        if (OnePassword.read(reference, "The key that decrypts .env") !== key) {
            throw new Error(`1Password gave back another value for ${reference}, so .env.keys was kept.`);
        }

        writeFileSync(this.path, upsert(this.source(), EnvFile.KEY_REFERENCE, reference));
        rmSync(this.keysPath, { force: true });
        return reference;
    }

    /** Move the key from 1Password into `.env.keys`, and take the reference out of `.env`. The 1Password item stays. */
    moveKeyToFile(): void {
        if (this.keyFromFile()) throw new Error("The key is in .env.keys already.");

        const key = this.privateKey();
        EnvFile.writeKeys(this.root, key);
        writeFileSync(this.path, remove(this.source(), EnvFile.KEY_REFERENCE));
    }

    private static writeKeys(root: string, privateKey: string): void {
        writeFileSync(
            join(root, ".env.keys"),
            `# The key that decrypts .env. Never commit it: .gitignore keeps it out of git. Share it with your team through a password manager.\n${EnvFile.PRIVATE_KEY}="${privateKey}"\n`
        );
    }

    /** A new `.env` with a new keypair, its private key in `.env.keys` or in 1Password. */
    static create(root: string, store: KeyStore): void {
        const pair = keypair();
        let reference = "";

        if (store.kind === "1password") {
            reference = `\n# The key that decrypts this file is in 1Password, here. Circuit reads it with the 1Password CLI, op.\n${EnvFile.KEY_REFERENCE}="${OnePassword.create(store.vault, store.title, pair.privateKey)}"\n`;
        } else {
            EnvFile.writeKeys(root, pair.privateKey);
        }

        writeFileSync(
            join(root, ".env"),
            `# The project's secrets, each one encrypted, so this file is safe to commit. Add or change one with: circuit secret set NAME
# The public key below can only encrypt. The key that decrypts is never committed.
${EnvFile.PUBLIC_KEY}="${pair.publicKey}"
${reference}`
        );
    }
}
