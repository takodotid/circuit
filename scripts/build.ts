// Builds the `circuit` binary into dist/: one file with Bun inside, so a user installs nothing else. `bun run build`, or `bun scripts/build.ts --target=bun-linux-x64` for another system.

import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { generated } from "./editor-types";

const root = join(import.meta.dir, "..");

// The files `circuit init` writes for the editor, from the sources as they are now.
writeFileSync(join(root, "src", "cli", "editor-types.generated.ts"), generated());

const target = process.argv.find((arg) => arg.startsWith("--target="))?.slice("--target=".length);
const windows = target ? target.includes("windows") : process.platform === "win32";
const outfile = join(root, "dist", `circuit${target ? `-${target.replace(/^bun-/, "")}` : ""}${windows ? ".exe" : ""}`);

const build = spawnSync(
    "bun",
    ["build", "src/cli/index.ts", "--compile", "--minify", "--sourcemap", ...(target ? [`--target=${target}`] : []), "--outfile", outfile],
    {
        cwd: root,
        stdio: "inherit",
    }
);
process.exit(build.status ?? 1);
