// Builds Studio's page with Vite into dist/studio/, then writes src/studio/assets.generated.ts: every file of it, so the `circuit` binary serves the page from inside itself. `bun install`, `bun run check` and `bun run build` run it; git ignores what it writes.

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { build } from "vite";

const root = join(import.meta.dir, "..");
const out = join(root, "dist", "studio");

const TYPES: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
    ".woff2": "font/woff2",
    ".txt": "text/plain; charset=utf-8",
};

await build({ configFile: join(root, "src", "studio", "app", "vite.config.ts") });

const assets: Record<string, { type: string; body: string }> = {};
for (const file of (readdirSync(out, { recursive: true }) as string[]).sort()) {
    const path = join(out, file);
    const type = TYPES[extname(file)];
    if (!type) continue;

    assets[relative(out, path).replaceAll("\\", "/")] = { type, body: readFileSync(path).toString("base64") };
}

writeFileSync(
    join(root, "src", "studio", "assets.generated.ts"),
    `// Written by scripts/studio.ts from Studio's page, built by Vite: do not edit.\n\nexport const STUDIO_ASSETS: Record<string, { type: string; body: string }> = ${JSON.stringify(assets)};\n`
);
console.log(`Studio: ${Object.keys(assets).length} files`);
