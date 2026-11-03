// The files a project's editor reads, in `.circuit/types/`: Circuit's functions and types, so a project's files complete and check with nothing installed.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { EDITOR_FILES } from "./editor-types.generated";

export class EditorTypes {
    /** Where they go, in the project. */
    static readonly FOLDER = join(".circuit", "types");

    /** The project's `tsconfig.json`: Circuit writes it when it starts a project. It reads Circuit's globals, and `circuit` for `import type` in `lib/`. */
    static readonly TSCONFIG = `${JSON.stringify(
        {
            compilerOptions: {
                strict: true,
                noEmit: true,
                target: "ES2022",
                module: "ESNext",
                moduleResolution: "bundler",
                skipLibCheck: true,
                types: [],
                paths: { circuit: ["./.circuit/types/config/index.ts"] },
            },
            include: ["**/*.ts", ".circuit/types/config/circuit.d.ts"],
        },
        null,
        4
    )}\n`;

    /** A full install's `tsconfig.json`: the types come from the Circuit package in `node_modules`, so the project has no `.circuit/types`. */
    static readonly TSCONFIG_FULL = `${JSON.stringify(
        {
            compilerOptions: {
                strict: true,
                noEmit: true,
                target: "ES2022",
                module: "ESNext",
                moduleResolution: "bundler",
                skipLibCheck: true,
                types: [],
                paths: { circuit: ["./node_modules/@takodotid/circuit/src/config/index.ts"] },
            },
            include: ["**/*.ts", "node_modules/@takodotid/circuit/src/config/circuit.d.ts"],
            exclude: ["node_modules/@takodotid/circuit/src/cli", "node_modules/@takodotid/circuit/src/studio"],
        },
        null,
        4
    )}\n`;

    /** Writes every file again, removing the old ones first. */
    static write(root: string): void {
        const folder = join(root, EditorTypes.FOLDER);
        rmSync(folder, { recursive: true, force: true });

        for (const [path, text] of Object.entries(EDITOR_FILES)) {
            mkdirSync(dirname(join(folder, path)), { recursive: true });
            writeFileSync(join(folder, path), text);
        }
    }

    /** Whether the project's types are this Circuit's: every file as this Circuit writes it. No version is kept beside them: the project's version is `.circuit/version`, and the files themselves say whether they are current. */
    static current(root: string): boolean {
        const folder = join(root, EditorTypes.FOLDER);
        return Object.entries(EDITOR_FILES).every(([path, text]) => {
            const file = join(folder, path);
            return existsSync(file) && readFileSync(file, "utf8") === text;
        });
    }
}
