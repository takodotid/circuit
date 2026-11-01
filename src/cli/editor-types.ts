// The files a project's editor reads, in `.circuit/types/`: Circuit's functions and types, so a project's files complete and check with nothing installed.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { EDITOR_FILES } from "./editor-types.generated";
import { VERSION } from "./version";

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

    /** What marks the files as this Circuit's: its version, and a hash of every file. */
    private static stamp(): string {
        const hash = createHash("sha256");
        for (const [path, text] of Object.entries(EDITOR_FILES)) hash.update(`${path}\n${text}\n`);
        return `${VERSION} ${hash.digest("hex").slice(0, 16)}\n`;
    }

    /** Writes every file again, removing the old ones first. */
    static write(root: string): void {
        const folder = join(root, EditorTypes.FOLDER);
        rmSync(folder, { recursive: true, force: true });

        for (const [path, text] of Object.entries(EDITOR_FILES)) {
            mkdirSync(dirname(join(folder, path)), { recursive: true });
            writeFileSync(join(folder, path), text);
        }

        writeFileSync(join(folder, "VERSION"), EditorTypes.stamp());
    }

    /** Whether the project's files are this Circuit's. */
    static current(root: string): boolean {
        const stamp = join(root, EditorTypes.FOLDER, "VERSION");
        return existsSync(stamp) && readFileSync(stamp, "utf8") === EditorTypes.stamp();
    }
}
