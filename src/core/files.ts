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

/** The first name written out after a call to defineDevice: the device's own, not that of another device a link, a peer or a tunnel names further on. */
const FIRST_NAME = /^[\s\S]*?\bname\s*:\s*(["'`])(.*?)\1/;

/** Whether a file's text declares the device: it calls defineDevice and gives it the name, written out whole. */
export function declaresDevice(text: string, name: string): boolean {
    return [...text.matchAll(/\bdefineDevice\s*\(/g)].some(
        (call) => FIRST_NAME.exec(text.slice(call.index + call[0].length))?.[2] === name
    );
}

/** The project files that declare the device, relative to the root. */
export function deviceFiles(root: string, name: string, sources = projectSources(root)): string[] {
    return sources.filter((file) => declaresDevice(readFileSync(join(root, file), "utf8"), name));
}
