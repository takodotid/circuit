// Builds Studio's page into dist/studio/. `bun scripts/studio.ts` runs it and carries the result into Circuit.

import vue from "@vitejs/plugin-vue";
import { join } from "node:path";
import { defineConfig } from "vite";
import { FieldDocsReader } from "../field-docs.ts";

export default defineConfig({
    root: import.meta.dirname,
    plugins: [vue()],
    // The doc comment of every field a device holds, read from src/config/, for the page to show on hover.
    define: { __FIELD_DOCS__: JSON.stringify(FieldDocsReader.pack(FieldDocsReader.read(join(import.meta.dirname, "..", "..", "config")))) },
    logLevel: "warn",
    build: {
        outDir: join(import.meta.dirname, "..", "..", "..", "dist", "studio"),
        emptyOutDir: true,
        chunkSizeWarningLimit: 1500,
    },
});
