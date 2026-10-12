// The files each pattern starts with, read at build time from the templates `circuit new` copies.

import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const templates = fileURLToPath(new URL("../../../templates/", import.meta.url));

/** A pattern's files, then its directories, each directory once with a slash. */
function filesOf(pattern: string): string[] {
    const entries = readdirSync(templates + pattern, { withFileTypes: true });
    const files = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
    const directories = entries.filter((entry) => entry.isDirectory()).map((entry) => `${entry.name}/`);

    return [...files.sort(), ...directories.sort()];
}

export default {
    watch: ["../../../templates/**"],
    load: () => Object.fromEntries(["single-site", "edge-router", "colocation"].map((pattern) => [pattern, filesOf(pattern)])),
};

// What a page imports: VitePress replaces it with what `load` returned.
declare const data: Record<string, string[]>;
export { data };
