// Secrets are references in the config and values only at the moment a command is sent. A reference names a variable, set in the environment or in `.env` beside the config, or a file kept out of the repository. A variable's value may itself be a 1Password reference, `op://vault/item/field`, read with the 1Password CLI.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Secret } from "../schema";

/** The directory of the config file. `.env` and secret files are found from here. */
let root = process.cwd();

let envFile: Record<string, string> | undefined;
const fromOnePassword = new Map<string, string>();

/** Find `.env` and secret files from this directory, the config file's, instead of the working directory. */
export function useRoot(directory: string): void {
    root = directory;
    envFile = undefined;
}

/** `.env` beside the config, read once. */
function dotenv(): Record<string, string> {
    if (envFile) return envFile;

    envFile = {};
    const path = join(root, ".env");
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
function readOnePassword(name: string, reference: string): string {
    const cached = fromOnePassword.get(reference);
    if (cached !== undefined) return cached;

    let result: ReturnType<typeof Bun.spawnSync>;
    try {
        result = Bun.spawnSync(["op", "read", "--no-newline", reference], { stdout: "pipe", stderr: "pipe" });
    } catch {
        throw new Error(`secret ${name} is a 1Password reference, and the 1Password CLI, op, is not installed`);
    }

    if (result.exitCode !== 0) {
        const reason = result.stderr?.toString().trim() || `op exited with ${result.exitCode}`;
        throw new Error(`secret ${name}: 1Password could not read ${reference}: ${reason}`);
    }

    const value = result.stdout?.toString() ?? "";
    fromOnePassword.set(reference, value);
    return value;
}

export const isSecret = (value: unknown): value is Secret =>
    typeof value === "object" && value !== null && ("secret" in value || "secret_file" in value);

/** How a reference is written inside a marker: a variable's name, or `file:` and a path. */
export const referenceOf = (secret: Secret) => ("secret" in secret ? secret.secret : `file:${secret.secret_file}`);

/** Where a reference's value comes from, such as `.env` or `1Password, through .env`, without reading it. Undefined when it is set nowhere. */
export function sourceOf(reference: string): string | undefined {
    if (reference.startsWith("file:")) return existsSync(join(root, reference.slice("file:".length))) ? "a file" : undefined;

    const value = process.env[reference] || dotenv()[reference];
    if (!value) return undefined;

    // Bun loads `.env` into the environment when it starts in the same directory, so the same value in both came from `.env`.
    const where = process.env[reference] && process.env[reference] !== dotenv()[reference] ? "the environment" : ".env";

    return value.startsWith("op://") ? `1Password, through ${where}` : where;
}

/** The value behind a reference, as `referenceOf` writes it. */
function valueOf(reference: string): string {
    if (reference.startsWith("file:")) {
        const path = reference.slice("file:".length);
        const fullPath = join(root, path);
        if (!existsSync(fullPath)) throw new Error(`secret file ${path} does not exist`);

        const value = readFileSync(fullPath, "utf8").trimEnd();
        if (!value) throw new Error(`secret file ${path} is empty`);

        return value;
    }

    const value = process.env[reference] || dotenv()[reference];
    if (!value) throw new Error(`secret ${reference} is not set in the environment or in .env`);

    return value.startsWith("op://") ? readOnePassword(reference, value) : value;
}

/** The value of a secret, or of a variable named directly. */
export const resolve = (secret: Secret | string): string => valueOf(typeof secret === "string" ? secret : referenceOf(secret));

/** How a secret appears in rendered config. Replaced with its value only when sent to a device. */
export const marker = (secret: Secret) => `<secret:${referenceOf(secret)}>`;

/** A marker anywhere in a command. Its group is the reference. */
export const MARKER = /<secret:([A-Za-z0-9_./:-]+)>/g;

/** Replace every marker in a command with its value. */
export const substitute = (text: string) => text.replace(MARKER, (_, reference: string) => valueOf(reference));

/** The value behind one marker's reference, for a platform that takes a secret interactively. */
export const valueOfReference = valueOf;
