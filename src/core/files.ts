// A project's own TypeScript files, and which of them declares a device: for renaming a device everywhere, and for a device's history.

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

/** Directories that hold no config of the project's own. */
const SKIPPED = new Set(["node_modules", ".git", ".circuit", "dist"]);

/** Every TypeScript file of the project, relative to its root, in name order. */
export function projectSources(root: string, directory = root): string[] {
    const entries = readdirSync(directory, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

    return entries.flatMap((entry) => {
        if (entry.isDirectory()) return SKIPPED.has(entry.name) ? [] : projectSources(root, join(directory, entry.name));
        return /\.(ts|mts|cts)$/.test(entry.name) ? [relative(root, join(directory, entry.name))] : [];
    });
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Whether a file's text declares the device: it calls defineDevice and gives it the name, written out whole. */
export function declaresDevice(text: string, name: string): boolean {
    const declares = new RegExp(`\\bname\\s*:\\s*(["'\`])${escape(name)}\\1`);
    return text.includes("defineDevice") && declares.test(text);
}

/** The project files that declare the device, relative to the root. */
export function deviceFiles(root: string, name: string, sources = projectSources(root)): string[] {
    return sources.filter((file) => declaresDevice(readFileSync(join(root, file), "utf8"), name));
}
