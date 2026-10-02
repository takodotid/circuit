// Secrets are references in the config and values only at the moment a command is sent. A reference names a variable in the environment or `.env.local`, or a file kept out of the repository.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Secret } from "../schema";

let localFile: Record<string, string> | undefined;

/** `.env.local` in the working directory, read once. */
function local(): Record<string, string> {
    if (localFile) return localFile;

    localFile = {};
    const path = join(process.cwd(), ".env.local");
    if (!existsSync(path)) return localFile;

    for (const line of readFileSync(path, "utf8").split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;

        const separator = trimmed.indexOf("=");
        if (separator <= 0) continue;

        localFile[trimmed.slice(0, separator).trim()] = trimmed.slice(separator + 1).trim();
    }

    return localFile;
}

export const isSecret = (value: unknown): value is Secret =>
    typeof value === "object" && value !== null && ("secret" in value || "secret_file" in value);

/** How a reference is written inside a marker: a variable's name, or `file:` and a path. */
const referenceOf = (secret: Secret) => ("secret" in secret ? secret.secret : `file:${secret.secret_file}`);

/** The value behind a reference, as `referenceOf` writes it. */
function valueOf(reference: string): string {
    if (reference.startsWith("file:")) {
        const path = reference.slice("file:".length);
        const fullPath = join(process.cwd(), path);
        if (!existsSync(fullPath)) throw new Error(`secret file ${path} does not exist`);

        const value = readFileSync(fullPath, "utf8").trimEnd();
        if (!value) throw new Error(`secret file ${path} is empty`);

        return value;
    }

    const value = process.env[reference] ?? local()[reference];
    if (!value) throw new Error(`secret ${reference} is not set in the environment or .env.local`);

    return value;
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
