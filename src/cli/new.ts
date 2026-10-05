// `circuit new`: start a project from one of the patterns in templates/. In a terminal it asks what it needs; the same answers can be given as options, for a script or an AI agent.

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

/** Circuit's own directory: this file runs from src/cli/ in Bun, and from dist/ once built. */
function packageRoot(): string {
    let directory = dirname(fileURLToPath(import.meta.url));

    while (!existsSync(join(directory, "templates"))) {
        const parent = dirname(directory);
        if (parent === directory) throw new Error("Circuit's templates are missing from its package");
        directory = parent;
    }

    return directory;
}

const ROOT = packageRoot();
const TEMPLATES = join(ROOT, "templates");
const circuit = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

/** How each package manager installs and runs. The templates are written for npm; the others are swapped in. */
const MANAGERS = {
    npm: { install: "npm install", run: "npx circuit", types: "node" },
    pnpm: { install: "pnpm install", run: "pnpm circuit", types: "node" },
    bun: { install: "bun install", run: "bun circuit", types: "bun" },
} as const;

type Manager = keyof typeof MANAGERS;

/** The package manager that started this, from what it says about itself, such as `pnpm/9.1.0 npm/? node/v22`. */
function detectManager(): Manager {
    const agent = process.env.npm_config_user_agent ?? "";
    if (agent.startsWith("pnpm/")) return "pnpm";
    if (agent.startsWith("bun/") || process.versions.bun) return "bun";
    return "npm";
}

const PATTERNS = {
    "single-site": { title: "A single site", fits: "a home, an office or an internal network: a router and a switch, no BGP", asn: false },
    "edge-router": { title: "An edge router", fits: "your own AS number, with an IP transit and an internet exchange", asn: true },
    colocation: {
        title: "Colocation with tenants",
        fits: "a provider whose customers each get their own VLANs, addresses and ports",
        asn: true,
    },
} as const;

type Pattern = keyof typeof PATTERNS;

/** The AS number the templates use, reserved for documentation by RFC 5398. */
const EXAMPLE_ASN = "64500";

const USAGE = `usage: circuit new [directory] [options]

  --pattern <name>   single-site, edge-router or colocation
  --asn <number>     your AS number, for edge-router and colocation
  --1password        write .env with 1Password references instead of empty values
  --use <manager>    npm, pnpm or bun; the one that ran this by default
  --no-install       do not install the dependencies`;

function fail(message: string): never {
    console.error(message);
    process.exit(1);
}

/** The value of `--name value` or `--name=value`. */
function option(args: string[], name: string): string | undefined {
    const at = args.indexOf(`--${name}`);
    if (at >= 0) return args[at + 1];
    return args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
}

/** Every file under a directory, relative to it. */
function filesIn(directory: string): string[] {
    return readdirSync(directory, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => relative(directory, join(entry.parentPath, entry.name)));
}

export async function create(args: string[]): Promise<void> {
    if (args.includes("--help") || args.includes("-h")) {
        console.log(USAGE);
        return;
    }

    const valued = new Set(["--pattern", "--asn", "--use"]);
    const positional = args.filter((arg, index) => !arg.startsWith("--") && !valued.has(args[index - 1] ?? ""));

    const interactive = process.stdin.isTTY === true;
    const terminal = interactive ? createInterface({ input: process.stdin, output: process.stdout }) : undefined;

    // The answer typed, or the fallback when nothing is typed or nobody is there to type.
    const ask = async (question: string, fallback: string) => {
        if (!terminal) return fallback;
        const answer = (await terminal.question(`${question} (${fallback}): `)).trim();
        return answer || fallback;
    };

    const directory = positional[0] ?? (await ask("Directory for the project", "my-network"));
    const target = resolve(process.cwd(), directory);
    if (existsSync(target) && readdirSync(target).length) fail(`${target} is not empty`);

    let pattern = option(args, "pattern") as Pattern | undefined;
    if (!pattern) {
        const names = Object.keys(PATTERNS) as Pattern[];
        if (terminal) {
            console.log("\nWhich is closest to your network?");
            names.forEach((name, index) => console.log(`  ${index + 1}. ${PATTERNS[name].title}: ${PATTERNS[name].fits}`));
        }
        pattern = names[Number(await ask("Number", "1")) - 1];
    }
    if (!pattern || !(pattern in PATTERNS)) fail(`no pattern ${pattern}; there are ${Object.keys(PATTERNS).join(", ")}`);

    let asn = option(args, "asn");
    if (!asn && PATTERNS[pattern].asn) {
        asn = await ask("Your AS number, or press enter to keep the documentation example", EXAMPLE_ASN);
    }
    if (asn && !/^\d+$/.test(asn)) fail(`${asn} is not an AS number`);

    const manager = (option(args, "use") ?? detectManager()) as Manager;
    if (!(manager in MANAGERS)) fail(`no package manager ${manager}; there are ${Object.keys(MANAGERS).join(", ")}`);
    const { install, run, types } = MANAGERS[manager];

    const onePassword =
        args.includes("--1password") || (await ask("Keep the secrets in 1Password? y or n", "n")).toLowerCase().startsWith("y");
    terminal?.close();

    // The pattern's files, then what every project has. npm leaves out a file named .gitignore, so it travels without the dot.
    cpSync(join(TEMPLATES, pattern), target, { recursive: true });
    cpSync(join(TEMPLATES, "project"), target, { recursive: true });
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

    const sources = filesIn(target).filter((file) => file.endsWith(".ts"));
    const secrets = new Set<string>();

    for (const file of sources) {
        const path = join(target, file);
        let text = readFileSync(path, "utf8");

        if (asn && asn !== EXAMPLE_ASN) text = text.replaceAll(new RegExp(`\\b${EXAMPLE_ASN}\\b`, "g"), asn);
        for (const [, name] of text.matchAll(/secret\("([A-Z0-9_]+)"\)/g)) secrets.add(name!);

        writeFileSync(path, text);
    }

    const env = [
        "# Secrets for Circuit. Never commit this file.",
        "# A value is the secret itself, or a 1Password reference, op://vault/item/field, read with the 1Password CLI.",
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
        dependencies: { "@takodotid/circuit": circuit.version },
        devDependencies: { [`@types/${types}`]: circuit.devDependencies[`@types/${types}`] },
    };
    writeFileSync(join(target, "package.json"), JSON.stringify(packageJson, null, 4) + "\n");

    if (!args.includes("--no-install")) {
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
        ...(PATTERNS[pattern].asn && (!asn || asn === EXAMPLE_ASN) ? ["Put your own AS number in routing.ts."] : []),
        `${run} validate`,
        `${run} snapshot, then ${run} diff, to see what would change on each device`,
    ];

    console.log(`\nCreated ${directory} from the pattern "${PATTERNS[pattern].title}".\n\nNext:`);
    steps.forEach((step, index) => console.log(`  ${index + 1}. ${step}`));
    console.log(`\nWhat each file does: https://circuit.tako.id/patterns/${pattern}`);
}
