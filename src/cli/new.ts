// `circuit new`: start a project from one of the patterns in templates/. In a terminal it asks what it needs; the same answers can be given as options, for a script or an AI agent.

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as prompts from "@clack/prompts";

type Manager = keyof typeof Scaffold.MANAGERS;

type Pattern = keyof typeof Scaffold.PATTERNS;

/** The answers given as options. A question is asked only for an answer missing here. */
export type ScaffoldOptions = {
    pattern?: string;
    asn?: string;
    onePassword?: boolean;
    use?: string;
    install: boolean;
};

export class Scaffold {
    private static readonly ROOT = Scaffold.packageRoot();
    private static readonly TEMPLATES = join(Scaffold.ROOT, "templates");
    private static readonly CIRCUIT = JSON.parse(readFileSync(join(Scaffold.ROOT, "package.json"), "utf8"));

    /** How each package manager installs and runs. The templates are written for npm; the others are swapped in. */
    static readonly MANAGERS = {
        npm: { install: "npm install", run: "npx circuit", types: "node" },
        pnpm: { install: "pnpm install", run: "pnpm circuit", types: "node" },
        bun: { install: "bun install", run: "bun circuit", types: "bun" },
    } as const;

    static readonly PATTERNS = {
        "single-site": {
            title: "A single site",
            fits: "a home, an office or an internal network: a router and a switch, no BGP",
            asn: false,
        },
        "edge-router": { title: "An edge router", fits: "your own AS number, with an IP transit and an internet exchange", asn: true },
        colocation: {
            title: "Colocation with tenants",
            fits: "a provider whose customers each get their own VLANs, addresses and ports",
            asn: true,
        },
    } as const;

    /** The AS number the templates use, reserved for documentation by RFC 5398. */
    private static readonly EXAMPLE_ASN = "64500";

    /** Circuit's own directory: this file runs from src/cli/ in Bun, and from dist/ once built. */
    private static packageRoot(): string {
        let directory = dirname(fileURLToPath(import.meta.url));

        while (!existsSync(join(directory, "templates"))) {
            const parent = dirname(directory);
            if (parent === directory) throw new Error("Circuit's templates are missing from its package");
            directory = parent;
        }

        return directory;
    }

    /** The package manager that started this, from what it says about itself, such as `pnpm/9.1.0 npm/? node/v22`. */
    private static detectManager(): Manager {
        const agent = process.env.npm_config_user_agent ?? "";
        if (agent.startsWith("pnpm/")) return "pnpm";
        if (agent.startsWith("bun/") || process.versions.bun) return "bun";
        return "npm";
    }

    private static fail(message: string): never {
        console.error(message);
        process.exit(1);
    }

    /** Every file under a directory, relative to it. */
    private static filesIn(directory: string): string[] {
        return readdirSync(directory, { recursive: true, withFileTypes: true })
            .filter((entry) => entry.isFile())
            .map((entry) => relative(directory, join(entry.parentPath, entry.name)));
    }

    /** Why a project cannot be created in this directory, or undefined when it can. */
    private static notEmpty(directory: string): string | undefined {
        const target = resolve(process.cwd(), directory);
        return existsSync(target) && readdirSync(target).length ? `${target} is not empty` : undefined;
    }

    /** The answer to a question in a terminal, or the fallback when nobody is there to answer. Cancelling a question ends the run. */
    private static async ask<T>(question: () => Promise<NoInfer<T> | symbol>, fallback: T): Promise<T> {
        if (process.stdin.isTTY !== true) return fallback;

        const answer = await question();
        if (prompts.isCancel(answer)) {
            prompts.cancel("Nothing created.");
            process.exit(1);
        }

        return answer as T;
    }

    static async create(directoryArgument: string | undefined, options: ScaffoldOptions): Promise<void> {
        const directory =
            directoryArgument ??
            (await Scaffold.ask(
                () =>
                    prompts.text({
                        message: "Directory for the project",
                        placeholder: "my-network",
                        defaultValue: "my-network",
                        validate: (value) => Scaffold.notEmpty(value || "my-network"),
                    }),
                "my-network"
            ));

        const notEmpty = Scaffold.notEmpty(directory);
        if (notEmpty) Scaffold.fail(notEmpty);
        const target = resolve(process.cwd(), directory);

        const names = Object.keys(Scaffold.PATTERNS) as Pattern[];
        const pattern =
            options.pattern ??
            (await Scaffold.ask(
                () =>
                    prompts.select({
                        message: "Which is closest to your network?",
                        options: names.map((name) => ({
                            value: name,
                            label: Scaffold.PATTERNS[name].title,
                            hint: Scaffold.PATTERNS[name].fits,
                        })),
                    }),
                names[0]!
            ));
        if (!Object.hasOwn(Scaffold.PATTERNS, pattern)) Scaffold.fail(`no pattern ${pattern}; there are ${names.join(", ")}`);
        const chosen = Scaffold.PATTERNS[pattern as Pattern];

        let asn = options.asn;
        if (!asn && chosen.asn) {
            asn = await Scaffold.ask(
                () =>
                    prompts.text({
                        message: "Your AS number, or press enter to keep the documentation example",
                        placeholder: Scaffold.EXAMPLE_ASN,
                        defaultValue: Scaffold.EXAMPLE_ASN,
                        validate: (value) => (!value || /^\d+$/.test(value) ? undefined : `${value} is not an AS number`),
                    }),
                Scaffold.EXAMPLE_ASN
            );
        }
        if (asn && !/^\d+$/.test(asn)) Scaffold.fail(`${asn} is not an AS number`);

        const manager = options.use ?? Scaffold.detectManager();
        if (!Object.hasOwn(Scaffold.MANAGERS, manager)) {
            Scaffold.fail(`no package manager ${manager}; there are ${Object.keys(Scaffold.MANAGERS).join(", ")}`);
        }
        const { install, run, types } = Scaffold.MANAGERS[manager as Manager];

        const onePassword =
            options.onePassword ||
            (await Scaffold.ask(() => prompts.confirm({ message: "Keep the secrets in 1Password?", initialValue: false }), false));

        // The pattern's files, then what every project has. npm leaves out a file named .gitignore, so it travels without the dot.
        cpSync(join(Scaffold.TEMPLATES, pattern), target, { recursive: true });
        cpSync(join(Scaffold.TEMPLATES, "project"), target, { recursive: true });
        renameSync(join(target, "gitignore"), join(target, ".gitignore"));

        // What the templates say about npm, said for the package manager in use.
        for (const file of ["AGENTS.md", "README.md", "tsconfig.json"]) {
            const path = join(target, file);
            const text = readFileSync(path, "utf8")
                .replaceAll("npx circuit", run)
                .replaceAll("npm install", install)
                .replaceAll('"types": ["node"]', `"types": ["${types}"]`);
            writeFileSync(path, text);
        }

        const sources = Scaffold.filesIn(target).filter((file) => file.endsWith(".ts"));
        const secrets = new Set<string>();

        for (const file of sources) {
            const path = join(target, file);
            let text = readFileSync(path, "utf8");

            if (asn && asn !== Scaffold.EXAMPLE_ASN) text = text.replaceAll(new RegExp(`\\b${Scaffold.EXAMPLE_ASN}\\b`, "g"), asn);
            for (const [, name] of text.matchAll(/secret\("([A-Z0-9_]+)"\)/g)) secrets.add(name!);

            writeFileSync(path, text);
        }

        const env = [
            "# Secrets for Circuit. Never commit this file.",
            "# A value is the secret itself, or a 1Password reference, op://vault/item/field, read with the 1Password CLI.",
            "# Put quotes around a value that has a # in it: without them, # starts a comment.",
            ...[...secrets].sort().map((name) => (onePassword ? `${name}=op://Network/${name}/password` : `${name}=`)),
            "",
        ];
        writeFileSync(join(target, ".env"), env.join("\n"));

        const name = basename(target)
            .toLowerCase()
            .replace(/[^a-z0-9-]+/g, "-");
        const packageJson = {
            name,
            private: true,
            type: "module",
            dependencies: { "@takodotid/circuit": Scaffold.CIRCUIT.version },
            devDependencies: { [`@types/${types}`]: Scaffold.CIRCUIT.devDependencies[`@types/${types}`] },
        };
        writeFileSync(join(target, "package.json"), JSON.stringify(packageJson, null, 4) + "\n");

        if (options.install) {
            // npm and pnpm are scripts on Windows, which only a shell runs.
            const result = spawnSync(install, { cwd: target, stdio: "inherit", shell: true });
            if (result.status !== 0) console.log(`${install} failed; run it again in the project.`);
        }

        const steps = [
            `cd ${directory}`,
            onePassword
                ? `Point each line of .env at the item that holds it in 1Password, then run: ${run} secrets`
                : `Fill in each password in .env, then run: ${run} secrets`,
            "Change the names, addresses and ports in the device files to your own.",
            ...(chosen.asn && (!asn || asn === Scaffold.EXAMPLE_ASN) ? ["Put your own AS number in routing.ts."] : []),
            `${run} validate`,
            `${run} snapshot, then ${run} diff, to see what would change on each device`,
        ];

        console.log(`\nCreated ${directory} from the pattern "${chosen.title}".\n\nNext:`);
        steps.forEach((step, index) => console.log(`  ${index + 1}. ${step}`));
        console.log(`\nWhat each file does: https://circuit.tako.id/patterns/${pattern}`);
    }
}
