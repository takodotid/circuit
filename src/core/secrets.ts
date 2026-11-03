// Secrets are references in the config and values only at the moment a command is sent. A reference names a variable, set in the environment or in the network's secrets file (see `SecretsFile`), or a file kept out of the repository. A value in the secrets file is encrypted, or a 1Password reference, `op://vault/item/field`, read with the 1Password CLI.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Console, Device, IP, Secret } from "../model";
import { OnePassword, SecretsFile } from "./secrets-file";

/** Anything that holds secret references, such as a network's devices. */
type Network = object;

/** How a device is logged in to: its management address and SSH port, its connection user and that user's password, and its console. */
export type DeviceLogin = {
    /** Absent for a device reached only through its console. */
    host?: IP;
    port: number;
    user: string;
    /** The value, not a reference. Never print it. */
    password: string;
    console?: Console;
};

export class Secrets {
    /** The directory of the config file. The secrets file and secret files are found from here. */
    private static root = process.cwd();
    /** The secrets file of the network being worked on, relative to `root`. */
    private static fileName = SecretsFile.DEFAULT;

    private static values: Record<string, string> | undefined;
    /** Every value read in this run, so `scrub` can hide it. */
    private static readonly revealed = new Set<string>();

    /** What `scrub` puts where a secret was. */
    static readonly REDACTED = "<redacted>";

    /** A value in plain text shorter than this is not hidden: hiding a short one would garble the text. */
    private static readonly SHORTEST_PLAIN_VALUE = 6;

    /** A marker anywhere in a command. Its group is the reference. */
    static readonly MARKER = /<secret:([A-Za-z0-9_./:-]+)>/g;

    /** Find the secrets file and secret files from this directory, the config file's, instead of the working directory. */
    static useRoot(directory: string): void {
        Secrets.root = directory;
        Secrets.useFile(SecretsFile.DEFAULT);
    }

    /** Read secrets from this file, relative to the project: the one a network's `secrets.file` names, or `.circuit/secrets`. */
    static useFile(name: string = SecretsFile.DEFAULT): void {
        Secrets.fileName = name;
        Secrets.values = undefined;
    }

    /** The secrets file in use. */
    static file(): SecretsFile {
        return SecretsFile.at(Secrets.root, Secrets.fileName);
    }

    /** The secrets file's values as written, read once. A `#` starts a comment unless the value is quoted. */
    private static stored(): Record<string, string> {
        if (Secrets.values) return Secrets.values;

        const file = Secrets.file();
        Secrets.refuseCutValues(file.exists() ? readFileSync(file.path, "utf8") : "", file.name);
        Secrets.values = file.values();
        return Secrets.values;
    }

    /** An unquoted value is cut at a `#`. A `#` after a space is a comment, but one inside the value, as in `abc#def`, would cut a value short and send that to a device, so it stops the run and asks for quotes. */
    private static refuseCutValues(text: string, name: string): void {
        for (const line of text.split(/\r?\n/)) {
            const [, key, value] = /^\s*(?:export\s+)?([\w.-]+)\s*=\s*(.*)$/.exec(line) ?? [];
            if (!key || !value || /^['"`]/.test(value) || !/\S#/.test(value)) continue;

            throw new Error(`${name}: the value of ${key} has a # in it, which starts a comment there; put the value in quotes`);
        }
    }

    static isSecret(value: unknown): value is Secret {
        return typeof value === "object" && value !== null && ("secret" in value || "secret_file" in value);
    }

    /** How a reference is written inside a marker: a variable's name, or `file:` and a path. */
    static referenceOf(secret: Secret): string {
        return "secret" in secret ? secret.secret : `file:${secret.secret_file}`;
    }

    /** Where a reference's value comes from, such as `.circuit/secrets, encrypted` or `1Password, through the environment`, without reading it. Undefined when it is set nowhere. */
    static sourceOf(reference: string): string | undefined {
        if (reference.startsWith("file:")) return existsSync(join(Secrets.root, reference.slice("file:".length))) ? "a file" : undefined;

        const where = process.env[reference] ? "the environment" : Secrets.file().name;
        const value = process.env[reference] || Secrets.stored()[reference];
        if (!value) return undefined;

        if (value.startsWith("op://")) return `1Password, through ${where}`;
        return SecretsFile.isEncrypted(value) ? `${where}, encrypted` : where;
    }

    /** The value behind a reference, as `referenceOf` writes it: one marker's reference, for a platform that takes a secret interactively. */
    static valueOf(reference: string): string {
        if (reference.startsWith("file:")) {
            const path = reference.slice("file:".length);
            const fullPath = join(Secrets.root, path);
            if (!existsSync(fullPath)) throw new Error(`secret file ${path} does not exist`);

            const value = readFileSync(fullPath, "utf8").trimEnd();
            if (!value) throw new Error(`secret file ${path} is empty`);

            Secrets.revealed.add(value);
            return value;
        }

        // The file is read first even when the environment has the value, so a value cut at a `#` is caught anyway.
        const fromFile = Secrets.stored()[reference];
        const fromEnvironment = process.env[reference];
        if (!fromEnvironment && fromFile === undefined)
            throw new Error(
                `secret ${reference} is not set in ${Secrets.file().name}: set it with ${SecretsFile.command(Secrets.file().name, `set ${reference}`)}`
            );

        const revealed = fromEnvironment
            ? fromEnvironment.startsWith("op://")
                ? OnePassword.read(fromEnvironment, `secret ${reference}`)
                : fromEnvironment
            : Secrets.file().decrypt(reference, fromFile!);
        if (!revealed) throw new Error(`secret ${reference} is empty in ${Secrets.file().name}`);

        Secrets.revealed.add(revealed);
        return revealed;
    }

    /** The value of a secret, or of a variable named directly: from the environment, the secrets file, 1Password or a file. */
    static reveal(secret: Secret | string): string {
        return Secrets.valueOf(typeof secret === "string" ? secret : Secrets.referenceOf(secret));
    }

    /** Every secret reference in a value, however deep, such as a network or one device, as `referenceOf` writes it. */
    static referencesIn(value: unknown, found = new Set<string>()): Set<string> {
        if (Secrets.isSecret(value)) found.add(Secrets.referenceOf(value));
        else if (Array.isArray(value)) for (const item of value) Secrets.referencesIn(item, found);
        else if (typeof value === "object" && value !== null) for (const item of Object.values(value)) Secrets.referencesIn(item, found);

        return found;
    }

    /**
     * The secrets file when a secret of `value`, such as a device, is encrypted in it and no password is at hand: the person has to type
     * it before the work starts. Undefined when every secret can be read. A password in the environment or 1Password opens the file here.
     */
    static lockedFor(value: unknown): SecretsFile | undefined {
        const file = Secrets.file();
        const needed = [...Secrets.referencesIn(value)].some(
            (reference) =>
                !reference.startsWith("file:") && !process.env[reference] && SecretsFile.isEncrypted(Secrets.stored()[reference] ?? "")
        );
        return needed && !file.tryUnlock() ? file : undefined;
    }

    /**
     * Text with every secret value Circuit knows replaced by `<redacted>`, before it is printed. Devices echo what they are sent, passwords too.
     *
     * Hidden are: each value in plain text in the secrets file of at least six characters, each value read in this run (1Password reads and secret files among them), each secret of `network` that the environment, the secrets file or a file holds, and `extra`. A 1Password reference not read in this run is not read for this.
     */
    static scrub(text: string, options: { network?: Network; extra?: readonly string[] } = {}): string {
        const values = new Set<string>(options.extra ?? []);

        // An encrypted value or a reference is not the secret itself.
        for (const [name, value] of Object.entries(Secrets.stored())) {
            if (
                name !== SecretsFile.PASSWORD &&
                value.length >= Secrets.SHORTEST_PLAIN_VALUE &&
                SecretsFile.kindOf(value) === "not encrypted"
            )
                values.add(value);
        }

        for (const value of Secrets.revealed) values.add(value);

        for (const reference of Secrets.referencesIn(options.network)) {
            const value = Secrets.storedValueOf(reference);
            if (value) values.add(value);
        }

        // Longest first, so a value that holds another is hidden whole.
        const ordered = [...values].filter(Boolean).sort((a, b) => b.length - a.length);
        return ordered.reduce((out, value) => out.split(value).join(Secrets.REDACTED), text);
    }

    /** The value behind a reference when it can be had without asking anyone: a 1Password reference only once read in this run, an encrypted value only with the file open. Undefined otherwise. */
    private static storedValueOf(reference: string): string | undefined {
        if (reference.startsWith("file:")) {
            const path = join(Secrets.root, reference.slice("file:".length));
            return existsSync(path) ? readFileSync(path, "utf8").trimEnd() : undefined;
        }

        const fromEnvironment = process.env[reference];
        if (fromEnvironment) return fromEnvironment.startsWith("op://") ? OnePassword.cached(fromEnvironment) : fromEnvironment;

        const value = Secrets.stored()[reference];
        return value ? Secrets.file().revealIfOpen(reference, value) : undefined;
    }

    /** How Circuit logs in to a device: its address, port, connection user, that user's password revealed, and its console. */
    static loginOf(device: Device): DeviceLogin {
        const user = device.system?.users?.[device.connection.user];
        if (!user) throw new Error(`${device.name}: connection user ${device.connection.user} is not one of its users`);

        return {
            ...(device.connection.host ? { host: device.connection.host } : {}),
            port: device.connection.port ?? 22,
            user: device.connection.user,
            password: Secrets.reveal(user.password),
            ...(device.connection.console ? { console: device.connection.console } : {}),
        };
    }

    /** How a secret appears in rendered config. Replaced with its value only when sent to a device. */
    static marker(secret: Secret): string {
        return `<secret:${Secrets.referenceOf(secret)}>`;
    }

    /** Replace every marker in a command with its value. */
    static substitute(text: string): string {
        return text.replace(Secrets.MARKER, (_, reference: string) => Secrets.valueOf(reference));
    }
}
