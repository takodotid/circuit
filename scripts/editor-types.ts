// Writes src/cli/editor-types.generated.ts: every file a project's editor reads, so `circuit init` can write them into the project from the binary. `bun run build` runs it; a test checks it is current.

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const src = join(import.meta.dir, "..", "src");

/** The files the editor needs: Circuit's config surface, and each platform's models, which the config's types read. */
export function editorFiles(): Record<string, string> {
    const files: Record<string, string> = {};
    for (const file of readdirSync(join(src, "config"))
        .filter((f) => f.endsWith(".ts"))
        .sort())
        files[`config/${file}`] = readFileSync(join(src, "config", file), "utf8");
    for (const platform of readdirSync(join(src, "platforms"), { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .sort())
        files[`platforms/${platform}/models.ts`] = readFileSync(join(src, "platforms", platform, "models.ts"), "utf8");
    return files;
}

export function generated(): string {
    return `// Written by scripts/editor-types.ts from src/config and each platform's models.ts: do not edit.\n\nexport const EDITOR_FILES: Record<string, string> = ${JSON.stringify(editorFiles(), null, 4)};\n`;
}

if (import.meta.main) writeFileSync(join(src, "cli", "editor-types.generated.ts"), generated());
