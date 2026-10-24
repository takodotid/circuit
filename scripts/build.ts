// Builds dist/ for Node, npm and pnpm: one JavaScript file per entry point, and type declarations. Bun runs src/ as it is.

import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

class Build {
    static async main(): Promise<void> {
        rmSync("dist", { recursive: true, force: true });

        const result = await Bun.build({
            entrypoints: ["src/index.ts", "src/helpers/index.ts", "src/cli/index.ts"],
            outdir: "dist",
            target: "node",
            format: "esm",
            splitting: true,
            // Every runtime dependency is installed beside Circuit, not copied into it.
            external: Object.keys(JSON.parse(readFileSync("package.json", "utf8")).dependencies),
            naming: { entry: "[dir]/[name].js", chunk: "chunks/[name]-[hash].js" },
        });

        if (!result.success) {
            for (const log of result.logs) console.error(log);
            process.exit(1);
        }

        const types = Bun.spawnSync(["bunx", "tsc", "-p", "tsconfig.build.json"], { stdout: "inherit", stderr: "inherit" });
        if (types.exitCode !== 0) process.exit(1);
        Build.addExtensions("dist/types");

        console.log(result.outputs.map((output) => output.path.replace(process.cwd(), ".")).join("\n"));
    }

    /**
     * Give each relative import in the declarations its file: `../schema` becomes `../schema/index.js`, `./common` becomes `./common.js`.
     * A project with `moduleResolution` `node16` or `nodenext` finds nothing without it, and gets every Circuit type as `any`, with no error.
     */
    static addExtensions(directory: string): void {
        for (const entry of readdirSync(directory, { recursive: true, encoding: "utf8" })) {
            if (!entry.endsWith(".d.ts")) continue;

            const path = join(directory, entry);
            const text = readFileSync(path, "utf8").replace(
                /(\bfrom\s+|\bimport\(\s*)(["'])(\.{1,2}(?:\/[^"']*)?)\2/g,
                (_, before: string, quote: string, specifier: string) => `${before}${quote}${Build.withFile(path, specifier)}${quote}`
            );
            writeFileSync(path, text);
        }
    }

    /** The import with its file: the declaration it names, or the folder's index. */
    private static withFile(from: string, specifier: string): string {
        if (specifier.endsWith(".js")) return specifier;

        const target = resolve(dirname(from), specifier);
        if (existsSync(`${target}.d.ts`)) return `${specifier}.js`;
        if (existsSync(join(target, "index.d.ts"))) return `${specifier}/index.js`;

        throw new Error(`${from}: no declaration for ${specifier}`);
    }
}

await Build.main();
