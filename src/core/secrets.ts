// Secrets are references in the config and values only at the moment a command is sent. A reference names a variable, set in the environment or in `.env` beside the config, or a file kept out of the repository. A variable's value may itself be a 1Password reference, `op://vault/item/field`, read with the 1Password CLI.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Secret } from "../schema";

export class Secrets {
    /** The directory of the config file. `.env` and secret files are found from here. */
    private static root = process.cwd();

    private static envFile: Record<string, string> | undefined;
    private static readonly fromOnePassword = new Map<string, string>();

    /** A marker anywhere in a command. Its group is the reference. */
    static readonly MARKER = /<secret:([A-Za-z0-9_./:-]+)>/g;

    /** Find `.env` and secret files from this directory, the config file's, instead of the working directory. */
    static useRoot(directory: string): void {
        Secrets.root = directory;
        Secrets.envFile = undefined;
    }

    /** `.env` beside the config, read once. */
    private static dotenv(): Record<string, string> {
        if (Secrets.envFile) return Secrets.envFile;

        const envFile: Record<string, string> = {};
        Secrets.envFile = envFile;

        const path = join(Secrets.root, ".env");
        if (!existsSync(path)) return envFile;

        for (const line of readFileSync(path, "utf8").split("\n")) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith("#")) continue;

            const separator = trimmed.indexOf("=");
            if (separator <= 0) continue;

            const value = trimmed.slice(separator + 1).trim();
            const unquoted = /^(["']).*\1$/.test(value) ? value.slice(1, -1) : value;
            envFile[trimmed.slice(0, separator).trim()] = unquoted;
        }

        return envFile;
    }

    /** Read a 1Password reference with the 1Password CLI, `op`, once per run. */
    private static readOnePassword(name: string, reference: string): string {
        const cached = Secrets.fromOnePassword.get(reference);
        if (cached !== undefined) return cached;

        const result = spawnSync("op", ["read", "--no-newline", reference], { encoding: "utf8" });

        if (result.error) throw new Error(`secret ${name} is a 1Password reference, and the 1Password CLI, op, is not installed`);

        if (result.status !== 0) {
            const reason = result.stderr.trim() || `op exited with ${result.status}`;
            throw new Error(`secret ${name}: 1Password could not read ${reference}: ${reason}`);
        }

        const value = result.stdout;
        Secrets.fromOnePassword.set(reference, value);
        return value;
    }

    static isSecret(value: unknown): value is Secret {
        return typeof value === "object" && value !== null && ("secret" in value || "secret_file" in value);
    }

    /** How a reference is written inside a marker: a variable's name, or `file:` and a path. */
    static referenceOf(secret: Secret): string {
        return "secret" in secret ? secret.secret : `file:${secret.secret_file}`;
    }

    /** Where a reference's value comes from, such as `.env` or `1Password, through .env`, without reading it. Undefined when it is set nowhere. */
    static sourceOf(reference: string): string | undefined {
        if (reference.startsWith("file:")) return existsSync(join(Secrets.root, reference.slice("file:".length))) ? "a file" : undefined;

        const value = process.env[reference] || Secrets.dotenv()[reference];
        if (!value) return undefined;

        // Bun loads `.env` into the environment when it starts in the same directory, so the same value in both came from `.env`.
        const where = process.env[reference] && process.env[reference] !== Secrets.dotenv()[reference] ? "the environment" : ".env";

        return value.startsWith("op://") ? `1Password, through ${where}` : where;
    }

    /** The value behind a reference, as `referenceOf` writes it: one marker's reference, for a platform that takes a secret interactively. */
    static valueOf(reference: string): string {
        if (reference.startsWith("file:")) {
            const path = reference.slice("file:".length);
            const fullPath = join(Secrets.root, path);
            if (!existsSync(fullPath)) throw new Error(`secret file ${path} does not exist`);

            const value = readFileSync(fullPath, "utf8").trimEnd();
            if (!value) throw new Error(`secret file ${path} is empty`);

            return value;
        }

        const value = process.env[reference] || Secrets.dotenv()[reference];
        if (!value) throw new Error(`secret ${reference} is not set in the environment or in .env`);

        return value.startsWith("op://") ? Secrets.readOnePassword(reference, value) : value;
    }

    /** The value of a secret, or of a variable named directly. */
    static resolve(secret: Secret | string): string {
        return Secrets.valueOf(typeof secret === "string" ? secret : Secrets.referenceOf(secret));
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
