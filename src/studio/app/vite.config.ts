// Builds Studio's page into dist/studio/. `bun scripts/studio.ts` runs it and carries the result into Circuit.

import vue from "@vitejs/plugin-vue";
import { join } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
    root: import.meta.dirname,
    plugins: [vue()],
    logLevel: "warn",
    build: {
        outDir: join(import.meta.dirname, "..", "..", "..", "dist", "studio"),
        emptyOutDir: true,
        chunkSizeWarningLimit: 1500,
    },
});
