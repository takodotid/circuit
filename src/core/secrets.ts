import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Secret } from "../schema";

let file: Record<string, string> | undefined;

/** `.env.local` in the working directory, read once. */
function local(): Record<string, string> {
    if (file) return file;

    file = {};
    const path = join(process.cwd(), ".env.local");
    if (!existsSync(path)) return file;

    for (const line of readFileSync(path, "utf8").split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;

        const separator = trimmed.indexOf("=");
        if (separator <= 0) continue;

        file[trimmed.slice(0, separator).trim()] = trimmed.slice(separator + 1).trim();
    }

    return file;
}

export const isSecret = (v: unknown): v is Secret => typeof v === "object" && v !== null && "secret" in v;

/** The value of a secret, from the environment first, then `.env.local`. */
export function resolve(s: Secret | string): string {
    const name = typeof s === "string" ? s : s.secret;
    const value = process.env[name] ?? local()[name];
    if (!value) throw new Error(`secret ${name} is not set in the environment or .env.local`);
    return value;
}

/** How a secret appears in rendered config. Replaced with its value only when sent to a device. */
export const marker = (s: Secret) => `<secret:${s.secret}>`;

/** Replace every marker in a command with its value. */
export const substitute = (text: string) => text.replace(/<secret:([A-Za-z0-9_]+)>/g, (_, name: string) => resolve(name));
