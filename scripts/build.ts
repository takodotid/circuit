// Builds the `circuit` binary into dist/: one file with Bun inside, so a user installs nothing else. `bun run build` builds for this system. `bun scripts/build.ts --release` builds every release file into dist/release/, named as `circuit update` downloads them, with SHA256SUMS.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { generated } from "./editor-types";

const root = join(import.meta.dir, "..");

/** Each release file and the Bun target it is built with. x64 takes Bun's baseline build, which runs on older processors too, such as a jump host's. */
const RELEASE: Record<string, string> = {
    "circuit-linux-x64": "bun-linux-x64-baseline",
    "circuit-linux-arm64": "bun-linux-arm64",
    "circuit-darwin-x64": "bun-darwin-x64-baseline",
    "circuit-darwin-arm64": "bun-darwin-arm64",
    "circuit-windows-x64.exe": "bun-windows-x64-baseline",
};

// The files Circuit writes for a project's editor, from the sources as they are now.
writeFileSync(join(root, "src", "cli", "editor-types.generated.ts"), generated());

// Studio's page, built and carried into the binary.
const studio = spawnSync("bun", ["scripts/studio.ts"], { cwd: root, stdio: "inherit" });
if (studio.status !== 0) process.exit(studio.status ?? 1);

/** Compile one binary. Circuit reads a project's `.env` itself, from the project's folder, so Bun is told not to load one. */
function compile(outfile: string, target?: string): void {
    const build = spawnSync(
        "bun",
        [
            "build",
            "src/cli/index.ts",
            "--compile",
            "--minify",
            "--sourcemap",
            "--no-compile-autoload-dotenv",
            "--no-compile-autoload-bunfig",
            ...(target ? [`--target=${target}`] : []),
            "--outfile",
            outfile,
        ],
        { cwd: root, stdio: "inherit" }
    );
    if (build.status !== 0) process.exit(build.status ?? 1);
}

if (process.argv.includes("--release")) {
    const folder = join(root, "dist", "release");
    mkdirSync(folder, { recursive: true });

    const sums: string[] = [];
    for (const [file, target] of Object.entries(RELEASE)) {
        compile(join(folder, file), target);
        sums.push(
            `${createHash("sha256")
                .update(readFileSync(join(folder, file)))
                .digest("hex")}  ${file}`
        );
    }

    writeFileSync(join(folder, "SHA256SUMS"), `${sums.join("\n")}\n`);
} else {
    compile(join(root, "dist", process.platform === "win32" ? "circuit.exe" : "circuit"));
}
