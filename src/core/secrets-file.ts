// A network's secrets file, `.circuit/secrets` unless `circuit({ secrets: { file } })` names another: `NAME="value"` lines, as in a `.env`, each value encrypted, so the file is safe to commit. Names stay readable, so git shows which secret changed. A value is AES-256-GCM, with a key made from the file's password by scrypt, and the secret's name bound to it, so a value moved to another name no longer opens.
//
// The password is never in the file. It comes from `CIRCUIT_SECRETS_PASSWORD` in the environment, from `CIRCUIT_SECRETS_PASSWORD="op://..."` in the file, a 1Password reference, or from the person, who types it. A value may also be a 1Password reference itself.
//
// After a yes, Circuit remembers the password typed and the values read from 1Password for 10 or 30 minutes, so the next commands don't ask: see src/cli/remember.ts. `hold` gives a run what is remembered.

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseEnv } from "node:util";

/** What a value in a secrets file is: encrypted, a 1Password reference, empty, or plain text, which Circuit refuses. */
export type SecretKind = "encrypted" | "1password" | "empty" | "not encrypted";

/** The 1Password CLI, `op`. */
export class OnePassword {
    /** Each reference read in this run, so 1Password asks once. */
    private static readonly cache = new Map<string, string>();
    /** The references whose values Circuit remembers from an earlier run, after a yes (src/cli/remember.ts). */
    private static readonly held = new Set<string>();
    /** Whether a remembered value was used in this run. */
    static usedHeld = false;

    static installed(): boolean {
        return !spawnSync("op", ["--version"], { encoding: "utf8" }).error;
    }

    /** A reference read before in this run, without asking 1Password. */
    static cached(reference: string): string | undefined {
        return OnePassword.cache.get(reference);
    }

    /** Values Circuit remembers, so this run reads them without asking 1Password. */
    static hold(values: Readonly<Record<string, string>>): void {
        for (const [reference, value] of Object.entries(values)) {
            OnePassword.cache.set(reference, value);
            OnePassword.held.add(reference);
        }
    }

    /** The values read from 1Password itself in this run, which Circuit does not remember yet. */
    static unheld(): Record<string, string> {
        return Object.fromEntries([...OnePassword.cache].filter(([reference]) => !OnePassword.held.has(reference)));
    }

    /** Forget every value of this run, as a new run starts with none. */
    static forget(): void {
        OnePassword.cache.clear();
        OnePassword.held.clear();
        OnePassword.usedHeld = false;
    }

    /** The value behind `op://vault/item/field`, read once per run. */
    static read(reference: string, what: string): string {
        const cached = OnePassword.cache.get(reference);
        if (cached !== undefined) {
            if (OnePassword.held.has(reference)) OnePassword.usedHeld = true;
            return cached;
        }

        const result = spawnSync("op", ["read", "--no-newline", reference], { encoding: "utf8" });
        if (result.error) throw new Error(`${what} is in 1Password, and the 1Password CLI, op, is not installed`);
        if (result.status !== 0)
            throw new Error(`${what}: 1Password could not read ${reference}: ${result.stderr.trim() || `op exited with ${result.status}`}`);

        OnePassword.cache.set(reference, result.stdout);
        return result.stdout;
    }
}

export class SecretsFile {
    /** Where a network's secrets are when `circuit()` names no file. */
    static readonly DEFAULT = ".circuit/secrets";
    /** The name that holds the password: in the environment as the password or a 1Password reference, in the file only as a 1Password reference. */
    static readonly PASSWORD = "CIRCUIT_SECRETS_PASSWORD";

    private static readonly ENCRYPTED = "encrypted:";
    private static readonly VERSION = 1;
    private static readonly SALT = 16;
    private static readonly IV = 12;
    private static readonly TAG = 16;
    /** scrypt's cost, OWASP's minimum: N = 2^17, r = 8, p = 1. About 0.2 s, once per run. */
    static readonly SCRYPT = { N: 2 ** 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };

    /** One file per path, so a password typed once opens it for the whole run. */
    private static readonly opened = new Map<string, SecretsFile>();

    readonly path: string;
    private password: string | undefined;
    private readonly keys = new Map<string, Buffer>();

    private constructor(
        readonly root: string,
        /** The path as the project writes it, relative to its root. */
        readonly name: string
    ) {
        this.path = join(root, name);
    }

    /** The secrets file at `name` in the project at `root`. */
    static at(root: string, name: string = SecretsFile.DEFAULT): SecretsFile {
        const path = join(root, name);
        let file = SecretsFile.opened.get(path);
        if (!file) SecretsFile.opened.set(path, (file = new SecretsFile(root, name)));
        return file;
    }

    /** Forget every password of this run, as a new run starts with none. */
    static forget(): void {
        SecretsFile.opened.clear();
        SecretsFile.held.clear();
        SecretsFile.usedHeld = false;
    }

    /** Passwords typed in an earlier run that Circuit remembers after a yes, by the file's full path. */
    private static readonly held = new Map<string, string>();
    /** Whether a remembered password was used in this run. */
    static usedHeld = false;

    /** Passwords Circuit remembers, by the file's full path, so this run opens those files without asking. */
    static hold(passwords: Readonly<Record<string, string>>): void {
        for (const [path, password] of Object.entries(passwords)) SecretsFile.held.set(resolve(path), password);
    }

    /** Whether Circuit already remembers this password for the file at `path`. */
    static holds(path: string, password: string): boolean {
        return SecretsFile.held.get(resolve(path)) === password;
    }

    static isEncrypted(value: string): boolean {
        return value.startsWith(SecretsFile.ENCRYPTED);
    }

    /** What a value is, by how it is written. */
    static kindOf(value: string): SecretKind {
        if (!value.trim()) return "empty";
        if (SecretsFile.isEncrypted(value)) return "encrypted";
        if (value.startsWith("op://")) return "1password";
        return "not encrypted";
    }

    /** What stops a commit of a secrets file's text: a value in plain text, or a password written as itself. Empty when it may be committed. */
    static problemsIn(text: string, name: string): string[] {
        const problems: string[] = [];
        const plain: string[] = [];

        for (const [key, value] of Object.entries(parseEnv(text) as Record<string, string>)) {
            if (key === SecretsFile.PASSWORD) {
                if (!value.startsWith("op://"))
                    problems.push(
                        `${name} holds its own password. Only a 1Password reference may be written there: ${SecretsFile.PASSWORD}="op://vault/item/field". Delete the line.`
                    );
            } else if (SecretsFile.kindOf(value) === "not encrypted") plain.push(key);
        }

        if (plain.length) problems.unshift(`${name} holds ${plain.join(", ")} in plain text. Encrypt it with circuit secrets encrypt.`);
        return problems;
    }

    exists(): boolean {
        return existsSync(this.path);
    }

    private source(): string {
        return this.exists() ? readFileSync(this.path, "utf8") : "";
    }

    /** Every name and value in the file, as written. */
    values(): Record<string, string> {
        return parseEnv(this.source()) as Record<string, string>;
    }

    /** The secrets' names: every name but the password's. */
    names(): string[] {
        return Object.keys(this.values()).filter((name) => name !== SecretsFile.PASSWORD);
    }

    /** The names whose value is plain text. */
    plaintext(): string[] {
        return Object.entries(this.values())
            .filter(([name, value]) => name !== SecretsFile.PASSWORD && SecretsFile.kindOf(value) === "not encrypted")
            .map(([name]) => name);
    }

    /** What stops a commit of the file as it is now. */
    problems(): string[] {
        return SecretsFile.problemsIn(this.source(), this.name);
    }

    /** The encrypted values, by name. */
    private encrypted(): [string, string][] {
        return Object.entries(this.values()).filter(([name, value]) => name !== SecretsFile.PASSWORD && SecretsFile.isEncrypted(value));
    }

    /** Whether a value in the file is encrypted, so only its password opens the file. */
    hasEncrypted(): boolean {
        return this.encrypted().length > 0;
    }

    /** Where the password comes from without anyone typing it: the environment first, then a 1Password reference in the file. */
    private passwordSource(): { where: string; value: string } | undefined {
        const fromEnvironment = process.env[SecretsFile.PASSWORD];
        if (fromEnvironment) return { where: `the environment, ${SecretsFile.PASSWORD}`, value: fromEnvironment };

        const inFile = this.values()[SecretsFile.PASSWORD];
        if (inFile?.startsWith("op://")) return { where: this.name, value: inFile };
        return undefined;
    }

    /** Where the password comes from, said without reading it. Undefined when someone has to type it. */
    passwordLocation(): string | undefined {
        const source = this.passwordSource();
        if (!source) return undefined;
        return source.value.startsWith("op://") ? `1Password, ${source.value} (named in ${source.where})` : source.where;
    }

    /** Whether a value of the file can be read now: the password is known, or there is nothing encrypted. */
    unlocked(): boolean {
        return this.password !== undefined;
    }

    /** Open the file with the password from the environment or 1Password, when there is one. False when someone has to type it. */
    tryUnlock(): boolean {
        if (this.unlocked()) return true;

        const source = this.passwordSource();
        if (!source) return this.unlockHeld();

        const password = source.value.startsWith("op://") ? OnePassword.read(source.value, `The password of ${this.name}`) : source.value;
        this.unlock(password, source.where);
        return true;
    }

    /** Open the file with a password typed in an earlier run that Circuit remembers. One that no longer opens it is dropped. */
    private unlockHeld(): boolean {
        const password = SecretsFile.held.get(resolve(this.path));
        if (password === undefined) return false;

        try {
            this.unlock(password);
        } catch {
            SecretsFile.held.delete(resolve(this.path));
            return false;
        }
        SecretsFile.usedHeld = true;
        return true;
    }

    /** Open the file with a password. It must open the values already encrypted; a file with none takes any password. */
    unlock(password: string, from?: string): void {
        if (!password) throw new Error(`The password of ${this.name} cannot be empty.`);

        const first = this.encrypted()[0];
        if (first) {
            try {
                this.open(first[0], first[1], password);
            } catch {
                throw new Error(`${from ? `The password from ${from}` : "That password"} does not open ${this.name}.`);
            }
        }

        this.password = password;
    }

    /** A password made for a person who left it empty: 32 characters, 192 bits. */
    static generatePassword(): string {
        return randomBytes(24).toString("base64url");
    }

    private key(password: string, salt: Buffer): Buffer {
        const id = `${password}\0${salt.toString("hex")}`;
        let key = this.keys.get(id);
        if (!key) this.keys.set(id, (key = scryptSync(password, salt, 32, SecretsFile.SCRYPT)));
        return key;
    }

    /** A value, encrypted for `name`: `encrypted:` then base64 of the version, salt, IV, ciphertext and tag. */
    private seal(name: string, value: string, password: string, salt: Buffer): string {
        const iv = randomBytes(SecretsFile.IV);
        const cipher = createCipheriv("aes-256-gcm", this.key(password, salt), iv);
        cipher.setAAD(Buffer.from(name, "utf8"));
        const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);

        return (
            SecretsFile.ENCRYPTED +
            Buffer.concat([Buffer.from([SecretsFile.VERSION]), salt, iv, body, cipher.getAuthTag()]).toString("base64")
        );
    }

    /** The parts of an encrypted value. */
    static partsOf(value: string): { salt: Buffer; iv: Buffer; body: Buffer; tag: Buffer } {
        const bytes = Buffer.from(value.slice(SecretsFile.ENCRYPTED.length), "base64");
        const head = 1 + SecretsFile.SALT + SecretsFile.IV;
        if (bytes[0] !== SecretsFile.VERSION || bytes.length < head + SecretsFile.TAG) throw new Error("not a value Circuit encrypted");

        return {
            salt: bytes.subarray(1, 1 + SecretsFile.SALT),
            iv: bytes.subarray(1 + SecretsFile.SALT, head),
            body: bytes.subarray(head, bytes.length - SecretsFile.TAG),
            tag: bytes.subarray(bytes.length - SecretsFile.TAG),
        };
    }

    private open(name: string, value: string, password: string): string {
        const { salt, iv, body, tag } = SecretsFile.partsOf(value);
        const decipher = createDecipheriv("aes-256-gcm", this.key(password, salt), iv);
        decipher.setAAD(Buffer.from(name, "utf8"));
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
    }

    /** The salt new values take: the one the file's values have, so one key opens them all. A file without one gets a new one. */
    private salt(): Buffer {
        const first = this.encrypted()[0];
        return first ? Buffer.from(SecretsFile.partsOf(first[1]).salt) : randomBytes(SecretsFile.SALT);
    }

    private needPassword(): string {
        if (this.password === undefined && !this.tryUnlock())
            throw new Error(
                `${this.name} is encrypted, and Circuit has no password for it. Type it when Circuit asks, or give it in ${SecretsFile.PASSWORD}.`
            );
        return this.password!;
    }

    /** The value of a name: decrypted, or read from 1Password. A value in plain text is refused: it has to be encrypted first. */
    reveal(name: string): string {
        const value = this.values()[name];
        if (value === undefined || name === SecretsFile.PASSWORD) throw new Error(`${name} is not in ${this.name}`);
        return this.decrypt(name, value);
    }

    /** A value as written under `name`, decrypted or read from 1Password. */
    decrypt(name: string, value: string): string {
        const kind = SecretsFile.kindOf(value);
        if (kind === "1password") return OnePassword.read(value, name);
        if (kind === "empty") return value;
        if (kind === "not encrypted")
            throw new Error(`${name} is in plain text in ${this.name}. Encrypt it first: circuit secrets encrypt`);

        try {
            return this.open(name, value, this.needPassword());
        } catch (error) {
            if ((error as Error).message.includes("Circuit has no password")) throw error;
            throw new Error(`${name} in ${this.name} does not open with its password: it was changed by hand, or moved from another name.`);
        }
    }

    /** A value at hand without asking anyone: only when the file is open. */
    revealIfOpen(name: string, value: string): string | undefined {
        if (SecretsFile.kindOf(value) === "1password") return OnePassword.cached(value);
        if (!SecretsFile.isEncrypted(value)) return value;
        return this.unlocked() ? this.open(name, value, this.password!) : undefined;
    }

    /** Set a name: encrypted, or a 1Password reference as it is. The file must be open. */
    set(name: string, value: string): void {
        if (name === SecretsFile.PASSWORD)
            throw new Error(`${name} holds the password's 1Password reference: write it with circuit secrets password.`);
        const stored = value.startsWith("op://") ? SecretsFile.reference(value) : this.seal(name, value, this.needPassword(), this.salt());
        this.write(SecretsFile.upsert(this.source(), name, stored));
    }

    /** Write where the password is in 1Password into the file, or take it out with undefined. */
    setPasswordReference(reference: string | undefined): void {
        if (reference === undefined) {
            this.write(SecretsFile.without(this.source(), SecretsFile.PASSWORD));
            return;
        }
        this.write(SecretsFile.upsert(this.source(), SecretsFile.PASSWORD, SecretsFile.reference(reference)));
    }

    private static reference(value: string): string {
        if (!/^op:\/\/[^"\r\n]+$/.test(value)) throw new Error(`${value} is not a 1Password reference, op://vault/item/field`);
        return value;
    }

    /** Remove a name. False when it was not there. */
    remove(name: string): boolean {
        if (!(name in this.values()) || name === SecretsFile.PASSWORD) return false;
        this.write(SecretsFile.without(this.source(), name));
        return true;
    }

    /** A name at the start of a line, `NAME=` or `export NAME=`. */
    private static readonly ASSIGNMENT = /^[ \t]*(?:export[ \t]+)?([A-Za-z_][A-Za-z0-9_]*)[ \t]*=(.*)$/;

    /** A value as the editor shows it: as it is, in quotes only when it starts or ends with a space or a quote, which the quotes then keep. */
    private static shown(value: string): string {
        return /^\s|\s$|^["']/.test(value) ? `"${value}"` : value;
    }

    /** A value as the editor's line writes it: as typed, its spaces at either end dropped; one pair of quotes around it is taken off. */
    private static typed(text: string): string {
        const value = text.trim();
        return /^(["']).*\1$/s.test(value) && value.length >= 2 ? value.slice(1, -1) : value;
    }

    /** The whole file as a person edits it: every line in its place, each value decrypted. The file must be open. Never written to disk. */
    editable(): string {
        const lines = (this.source() || SecretsFile.HEADER).replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n");
        return `${lines
            .map((line) => {
                const name = SecretsFile.ASSIGNMENT.exec(line)?.[1];
                if (!name) return line;
                const value = (parseEnv(line) as Record<string, string>)[name] ?? "";
                return `${name}=${SecretsFile.shown(name === SecretsFile.PASSWORD ? value : this.decryptForEdit(name, value))}`;
            })
            .join("\n")}\n`;
    }

    /** A value decrypted for the editor: an encrypted one opened, anything else as written. */
    private decryptForEdit(name: string, value: string): string {
        return SecretsFile.isEncrypted(value) ? this.open(name, value, this.needPassword()) : value;
    }

    /**
     * Write the file from the text the editor holds: comments and blank lines as they are, each value encrypted, a value that did not
     * change kept as it was encrypted, so git shows only what changed. Gives back why it can't be written, or undefined once written.
     */
    saveEditable(text: string): string | undefined {
        const before = new Map<string, { stored: string; value: string }>();
        for (const [name, stored] of Object.entries(this.values()))
            before.set(name, { stored, value: name === SecretsFile.PASSWORD ? stored : this.decryptForEdit(name, stored) });

        const password = this.needPassword();
        const salt = this.salt();
        const seen = new Set<string>();
        const out: string[] = [];
        const lines = text.replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n");

        for (const [i, line] of lines.entries()) {
            if (!line.trim() || line.trim().startsWith("#")) {
                out.push(line);
                continue;
            }

            const match = SecretsFile.ASSIGNMENT.exec(line);
            if (!match) return `line ${i + 1}: write NAME=value, or a comment starting with #`;
            const [, name, raw] = match as unknown as [string, string, string];
            if (seen.has(name)) return `line ${i + 1}: ${name} is written twice`;
            seen.add(name);

            const value = SecretsFile.typed(raw);
            if (name === SecretsFile.PASSWORD) {
                if (!value.startsWith("op://") || value.includes('"'))
                    return `line ${i + 1}: ${name} may only be a 1Password reference, op://vault/item/field. The password itself never goes in the file.`;
                out.push(`${name}="${value}"`);
                continue;
            }

            if (value.includes('"') && value.startsWith("op://")) return `line ${i + 1}: a 1Password reference has no "`;
            const old = before.get(name);
            const stored =
                old && old.value === value && SecretsFile.kindOf(old.stored) !== "not encrypted"
                    ? old.stored
                    : value.startsWith("op://") || !value
                      ? value
                      : this.seal(name, value, password, salt);
            out.push(`${name}="${stored}"`);
        }

        this.write(`${out.join("\n")}\n`);
        return undefined;
    }

    /** Encrypt every value written in plain text. Gives back their names. */
    encryptAll(): string[] {
        const names = this.plaintext();
        if (!names.length) return [];

        const password = this.needPassword();
        const salt = this.salt();
        let text = this.source();
        for (const name of names) text = SecretsFile.upsert(text, name, this.seal(name, this.values()[name]!, password, salt));

        this.write(text);
        return names;
    }

    /** Encrypt every value again with a new password. The old one stops opening the file. */
    changePassword(next: string): void {
        if (!next) throw new Error(`The password of ${this.name} cannot be empty.`);

        const old = this.needPassword();
        const salt = randomBytes(SecretsFile.SALT);
        let text = this.source();
        for (const [name, value] of this.encrypted())
            text = SecretsFile.upsert(text, name, this.seal(name, this.open(name, value, old), next, salt));

        this.write(text);
        this.password = next;
    }

    private write(text: string): void {
        mkdirSync(dirname(this.path), { recursive: true });
        writeFileSync(this.path, text || SecretsFile.HEADER);
    }

    /** What a new file starts with. */
    static readonly HEADER =
        "# Circuit's secrets, each value encrypted, so this file is safe to commit. Change them with: circuit secrets\n";

    /** The line that sets `name`, matched however it is written. */
    private static line(name: string): RegExp {
        return new RegExp(`^[ \\t]*(?:export[ \\t]+)?${name}[ \\t]*=.*$`, "m");
    }

    /** Text with `name` set to `value`, in place when it is there, at the end when it is not. A new file starts with the header. */
    static upsert(text: string, name: string, value: string): string {
        const line = `${name}="${value}"`;
        if (SecretsFile.line(name).test(text)) return text.replace(SecretsFile.line(name), () => line);

        const base = text || SecretsFile.HEADER;
        return `${base}${base.endsWith("\n") ? "" : "\n"}${line}\n`;
    }

    /** Text without the line that sets `name`. */
    static without(text: string, name: string): string {
        return text.replace(new RegExp(`${SecretsFile.line(name).source}\\r?\\n?`, "m"), "");
    }
}
