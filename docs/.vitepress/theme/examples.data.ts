// The files of each example project in examples/, read at build time, for the home page's list of where to begin.

import { readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const examples = fileURLToPath(new URL("../../../examples/", import.meta.url));

/** Every file of a project, by its path in the project, folders after the files beside them. */
function filesOf(folder: string, prefix = ""): string[] {
    const entries = readdirSync(join(examples, folder, prefix), { withFileTypes: true });
    const files = entries.filter((entry) => entry.isFile()).map((entry) => `${prefix}${entry.name}`);
    const folders = entries.filter((entry) => entry.isDirectory()).flatMap((entry) => filesOf(folder, `${prefix}${entry.name}/`));

    return [...files.sort(), ...folders];
}

export default {
    watch: ["../../../examples/**"],
    load: () => Object.fromEntries(readdirSync(examples).map((name) => [name, filesOf(name)])),
};

// What a page imports: VitePress replaces it with what `load` returned.
declare const data: Record<string, string[]>;
export { data };
