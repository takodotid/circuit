// Saves what the CLI prints for every example, template and use case, then checks a later run prints the same. Run `save` before a refactor and `check` after: any difference is a change in behaviour.
//
//   bun scripts/golden.ts save     # into .golden/
//   bun scripts/golden.ts check    # compare with .golden/, print each file that differs

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

class Golden {
    static readonly ROOT = resolve(import.meta.dirname, "..");
    static readonly DIRECTORY = join(Golden.ROOT, ".golden");
    static readonly CLI = join(Golden.ROOT, "src/cli/index.ts");

    /** Every config the repository holds. */
    static readonly CONFIGS = [
        "examples/platforms/circuit.config.ts",
        ...["single-site", "edge-router", "colocation"].map((pattern) => `templates/${pattern}/circuit.config.ts`),
        ...["ip-transit", "ix-transit", "internet-exchange", "virtual-exchange", "regional-provider"].map(
            (name) => `examples/use-cases/${name}/circuit.config.ts`
        ),
    ];

    /** Commands that read only the config, the same on every run. */
    static readonly COMMANDS = [
        ["validate"],
        ["diff"],
        ["graph", "--layer=all", "--format=json"],
        ["graph", "--layer=all", "--format=mermaid"],
        ["graph", "--layer=all", "--format=dot"],
        ["addresses", "--format=json"],
        ["addresses"],
        ["prometheus"],
        ["prometheus", "--auths"],
        ["communities"],
        ["studio", "--json"],
    ];

    /** Run the CLI and keep what it printed, the exit code included. */
    static run(args: string[]): string {
        const result = spawnSync("bun", [Golden.CLI, ...args], {
            cwd: Golden.ROOT,
            encoding: "utf8",
            env: { ...process.env, NO_COLOR: "1" },
        });
        return `exit ${result.status}\n--- stdout\n${result.stdout}\n--- stderr\n${result.stderr}`;
    }

    /** Every output, by the file name it is saved under. */
    static async outputs(): Promise<Map<string, string>> {
        const outputs = new Map<string, string>();

        for (const config of Golden.CONFIGS) {
            const network = (await import(join(Golden.ROOT, config))).default as { devices: { name: string }[] };
            const prefix = config.replace(/\/circuit\.config\.ts$|\.config\.ts$/, "").replace(/[\\/]/g, "_");

            for (const command of Golden.COMMANDS) {
                outputs.set(`${prefix}__${command.join("_").replace(/[^\w=-]/g, "")}.txt`, Golden.run([...command, `--config=${config}`]));
            }

            for (const device of network.devices) {
                outputs.set(`${prefix}__build_${device.name}.txt`, Golden.run(["build", device.name, `--config=${config}`]));
            }
        }

        return outputs;
    }

    static async save(): Promise<void> {
        rmSync(Golden.DIRECTORY, { recursive: true, force: true });
        mkdirSync(Golden.DIRECTORY, { recursive: true });

        const outputs = await Golden.outputs();
        for (const [file, text] of outputs) writeFileSync(join(Golden.DIRECTORY, file), text);

        console.log(`saved ${outputs.size} outputs to .golden/`);
    }

    static async check(): Promise<void> {
        if (!existsSync(Golden.DIRECTORY)) throw new Error("no .golden/ yet: run `bun scripts/golden.ts save` first");

        const outputs = await Golden.outputs();
        const saved = new Set(readdirSync(Golden.DIRECTORY));
        const differ: string[] = [];

        for (const [file, text] of outputs) {
            if (!saved.has(file)) differ.push(`${file}: new`);
            else if (readFileSync(join(Golden.DIRECTORY, file), "utf8") !== text) differ.push(`${file}: differs`);
            saved.delete(file);
        }
        for (const file of saved) differ.push(`${file}: gone`);

        if (differ.length) {
            console.log(differ.join("\n"));
            console.log(
                `\n${differ.length} of ${outputs.size} outputs changed. Compare with: git diff --no-index .golden/<file> <(bun src/cli/index.ts ...)`
            );
            process.exit(1);
        }

        console.log(`all ${outputs.size} outputs match`);
    }
}

const mode = process.argv[2];
if (mode === "save") await Golden.save();
else if (mode === "check") await Golden.check();
else throw new Error("usage: bun scripts/golden.ts save|check");
