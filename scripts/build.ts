// Builds dist/ for Node, npm and pnpm: one JavaScript file per entry point, and type declarations. Bun runs src/ as it is.

import { rmSync } from "node:fs";

rmSync("dist", { recursive: true, force: true });

const result = await Bun.build({
    entrypoints: ["src/index.ts", "src/presets/index.ts", "src/cli/index.ts"],
    outdir: "dist",
    target: "node",
    format: "esm",
    splitting: true,
    // Installed beside Circuit, not copied into it.
    external: ["ssh2", "jiti"],
    naming: { entry: "[dir]/[name].js", chunk: "chunks/[name]-[hash].js" },
});

if (!result.success) {
    for (const log of result.logs) console.error(log);
    process.exit(1);
}

const types = Bun.spawnSync(["bunx", "tsc", "-p", "tsconfig.build.json"], { stdout: "inherit", stderr: "inherit" });
if (types.exitCode !== 0) process.exit(1);

console.log(result.outputs.map((output) => output.path.replace(process.cwd(), ".")).join("\n"));
