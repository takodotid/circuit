// A secret is a reference in the config, and a value only when a command is sent. A reference names a variable, set in the environment or the secrets file, or a file kept out of the repository.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Console, Device, IP, Secret } from "../model";
import { OnePassword } from "./one-password";
import { SecretsFile } from "./secrets-file";

export type DeviceLogin = {
    /** Absent for a device reached only through its console. */
    host?: IP;
    port: number;
    user: string;
    /** Reveals the password: called only when it is needed, as SSH tries the user's keys first. Never print it. */
    password: () => string;
    /** The OpenSSH public keys the user takes (`ssh_keys`), which SSH tries before the password. */
    keys: readonly string[];
    console?: Console;
};

export class Secrets {
    private static readonly SSH_PORT = 22;

    /** The directory of the config file. The secrets file and secret files are found from here. */
    private static root = process.cwd();
    /** The secrets file of the network being worked on, relative to `root`. */
    private static fileName = SecretsFile.DEFAULT;

    private static values: Record<string, string> | undefined;

    /** What `scrub` puts where a secret was. */
    static readonly REDACTED = "<redacted>";

    /** A shorter value is not hidden: it would also hide the same letters in ordinary words and numbers, such as `admin` or `65000`. */
    private static readonly SHORTEST_HIDDEN = 6;

    /** What `scrub` hides, longest first, so a value that holds another is hidden whole. */
    private static hidden: string[] = [];
    /** The references `watch` was given whose values were not at hand yet. */
    private static readonly watched = new Set<string>();

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

    /** An unquoted value is cut at a `#`. A `#` after a space starts a comment. One inside a value, as in `abc#def`, would send the cut value to a device, so it stops the run. */
    private static refuseCutValues(text: string, name: string): void {
        for (const line of text.split(/\r?\n/)) {
            const [, key, value] = /^\s*(?:export\s+)?([\w.-]+)\s*=\s*(.*)$/.exec(line) ?? [];
            if (!key || !value || /^['"`]/.test(value) || !/\S#/.test(value)) continue;

            throw new Error(`${name}: the value of ${key} has a # in it, which starts a comment there; put the value in quotes`);
        }
    }

    static isReference(value: unknown): value is Secret {
        return typeof value === "object" && value !== null && ("secret" in value || "secret_file" in value);
    }

    /** How a reference is written inside a marker: a variable's name, or `file:` and a path. */
    static referenceOf(secret: Secret): string {
        return "secret" in secret ? secret.secret : `file:${secret.secret_file}`;
    }

    /** The value behind a reference, as `referenceOf` writes it: one marker's reference, for a platform that takes a secret interactively. */
    static valueOf(reference: string): string {
        if (reference.startsWith("file:")) {
            const path = reference.slice("file:".length);
            const fullPath = join(Secrets.root, path);
            if (!existsSync(fullPath)) throw new Error(`secret file ${path} does not exist`);

            const value = readFileSync(fullPath, "utf8").trimEnd();
            if (!value) throw new Error(`secret file ${path} is empty`);

            Secrets.hide(value);
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

        Secrets.hide(revealed);
        return revealed;
    }

    /** The value of a secret, or of a variable named directly: from the environment, the secrets file, 1Password or a file. */
    static reveal(secret: Secret | string): string {
        return Secrets.valueOf(typeof secret === "string" ? secret : Secrets.referenceOf(secret));
    }

    /** Every secret reference in a value, however deep, such as a network or one device, as `referenceOf` writes it. */
    static referencesIn(value: unknown, found = new Set<string>()): Set<string> {
        if (Secrets.isReference(value)) found.add(Secrets.referenceOf(value));
        else if (Array.isArray(value)) for (const item of value) Secrets.referencesIn(item, found);
        else if (typeof value === "object" && value !== null) for (const item of Object.values(value)) Secrets.referencesIn(item, found);

        return found;
    }

    /**
     * The secrets file, when a secret of `value` is encrypted in it and no password is at hand. The person then types it before the work starts. A password in the environment or 1Password opens the file here.
     */
    static lockedFor(value: unknown): SecretsFile | undefined {
        const file = Secrets.file();
        const needed = [...Secrets.referencesIn(value)].some(
            (reference) =>
                !reference.startsWith("file:") && !process.env[reference] && SecretsFile.isEncrypted(Secrets.stored()[reference] ?? "")
        );
        return needed && !file.tryUnlock() ? file : undefined;
    }

    /** From now on, `scrub` also hides the value of each reference, as `referenceOf` writes it, once the value is at hand without asking anyone. */
    static watch(references: Iterable<string>): void {
        for (const reference of references) Secrets.watched.add(reference);
    }

    /**
     * Every secret value Circuit knows becomes `<redacted>`, as a device echoes what it is sent and quotes it in errors. These are the values read in this run, the plain values in the secrets file, and the watched values at hand. A 1Password reference is not read for this. Each line of a value is hidden on its own too, as a device ends lines its own way.
     */
    static scrub(text: string): string {
        Secrets.learn();
        return Secrets.hidden.reduce((out, value) => out.replaceAll(value, Secrets.REDACTED), text);
    }

    private static hide(value: string): void {
        const added = [value, ...value.split(/\r?\n/)].filter(
            (each) => each.length >= Secrets.SHORTEST_HIDDEN && !Secrets.hidden.includes(each)
        );
        if (added.length) Secrets.hidden = [...new Set([...Secrets.hidden, ...added])].sort((a, b) => b.length - a.length);
    }

    /** Hide the values that came to hand since the last time. `scrub` runs on what is printed, so a value that can't be read now is left for later, and never stops the print. */
    private static learn(): void {
        let stored: Record<string, string> = {};
        try {
            stored = Secrets.stored();
        } catch {
            // The run itself reports a secrets file it can't read.
        }

        // An encrypted value or a reference is not the secret itself.
        for (const [name, value] of Object.entries(stored))
            if (name !== SecretsFile.PASSWORD && SecretsFile.kindOf(value) === "not encrypted") Secrets.hide(value);

        for (const reference of Secrets.watched) {
            let value: string | undefined;
            try {
                value = Secrets.storedValueOf(reference);
            } catch {
                continue;
            }
            if (value === undefined) continue;

            Secrets.watched.delete(reference);
            Secrets.hide(value);
        }
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

    static loginOf(device: Device): DeviceLogin {
        const user = device.system?.users?.[device.connection.user];
        if (!user) throw new Error(`${device.name}: connection user ${device.connection.user} is not one of its users`);

        return {
            ...(device.connection.host ? { host: device.connection.host } : {}),
            port: device.connection.port ?? Secrets.SSH_PORT,
            user: device.connection.user,
            password: () => Secrets.reveal(user.password),
            keys: user.ssh_keys ?? [],
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
