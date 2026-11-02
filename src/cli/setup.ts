// A new project, started by the installer or from the menu: the folder, its files, the encrypted `.env`, git and its hook, and the editor's types. Also what Circuit keeps current in a project each time it runs in it.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { EnvFile, type KeyStore, OnePassword } from "../core/env-file";
import { EditorTypes } from "./editor-types";
import { GitHooks } from "./git-hooks";
import { Ui } from "./ui";
import { VERSION } from "./version";

const GENERATED_README = `# Written by Circuit

Do not edit anything here: an edit changes nothing on a device, and Circuit overwrites it. Change the project instead.

\`types/\` is what your editor reads to complete and check the project's files. Circuit writes it again when it is updated.

\`hooks/\` holds the git hook that checks each commit: no secret in plain text, no \`.env.keys\`, and a project that validates.
`;

const GITIGNORE = `# The key that decrypts .env. Never commit it.
.env.keys

node_modules/
.circuit/cache/
`;

/** What a new project is set up with. */
export type ProjectSetup = {
    folder: string;
    /** Simple: the binary alone. Full: Circuit as a package in the project, its version pinned in package.json. */
    kind: "simple" | "full";
    asn: number;
    git: boolean;
    keys: KeyStore;
    openInEditor: boolean;
};

export class Setup {
    /** The package a full install adds to the project. */
    static readonly PACKAGE = "@takodotid/circuit";

    private static installed(command: string): boolean {
        return !spawnSync(command, ["--version"], { encoding: "utf8", shell: process.platform === "win32" }).error;
    }

    /** Circuit installed in the project as a package, by a full install: the file to run it from. */
    static localCircuit(root: string): string | undefined {
        const path = join(root, "node_modules", ...Setup.PACKAGE.split("/"), "src", "cli", "index.ts");
        return existsSync(path) ? path : undefined;
    }

    /** What Circuit keeps current in a project, each time it runs in it: the editor's types, the git hook, and a warning for a secret in plain text. */
    static prepare(root: string): void {
        if (!EditorTypes.current(root)) {
            EditorTypes.write(root);
            writeFileSync(join(root, ".circuit", "README.md"), GENERATED_README);
            Ui.done(`Wrote the editor types for Circuit ${VERSION}.`);
        }

        const hooks = GitHooks.install(root);
        if (hooks) Ui.done(`${hooks[0]!.toUpperCase()}${hooks.slice(1)}.`);

        const plain = new EnvFile(root).plaintext();
        if (plain.length) Ui.warn(`.env holds ${plain.join(", ")} in plain text. Run circuit secret encrypt before you commit.`);
    }

    /** Ask how to set up a new project, then set it up. */
    static async ask(folder?: string): Promise<ProjectSetup> {
        Ui.intro("A new Circuit project");

        const name =
            folder ??
            (await Ui.text("Project folder", {
                initial: "network",
                check: (value) => {
                    if (!value.trim()) return "Type a folder name.";
                    const path = resolve(process.cwd(), value.trim());
                    return existsSync(path) && readdirSync(path).length ? "That folder already holds files. Pick another." : undefined;
                },
            }));

        const kind = await Ui.select<ProjectSetup["kind"]>("How should this project run Circuit?", [
            { value: "simple", label: "Simple (recommended)", hint: "the circuit command alone, nothing else to install" },
            { value: "full", label: "Full", hint: "Circuit as a package in the project, its version pinned for the whole team" },
        ]);

        if (kind === "full") {
            await Ui.select("Runtime", [
                { value: "bun", label: "Bun (recommended)" },
                { value: "node", label: "Node.js and npm", hint: "coming later", disabled: true },
                { value: "deno", label: "Deno", hint: "coming later", disabled: true },
            ]);
            if (!Setup.installed("bun")) await Setup.offerBun();
        }

        const asn = Number(
            await Ui.text("Your network's AS number", {
                initial: "64500",
                check: (value) => (/^\d+$/.test(value.trim()) ? undefined : "Type a number, such as 64500. Change it later in circuit.ts."),
            })
        );

        let git = false;
        if (GitHooks.gitInstalled()) git = await Ui.confirm("Start a git repository, so each change is kept and can be reviewed?", true);
        else Ui.warn("git is not installed, so the project is not a git repository. Install git, then run git init in the folder.");

        let keys: KeyStore = { kind: "file" };
        if (OnePassword.installed()) {
            const where = await Ui.select("Where to keep the key that decrypts .env?", [
                { value: "file", label: ".env.keys file (recommended)", hint: "in the folder, kept out of git" },
                { value: "1password", label: "1Password", hint: "read with the 1Password CLI each time" },
            ]);
            if (where === "1password") {
                const vaults = await Ui.step("Reading your 1Password vaults", async () => OnePassword.vaults());
                const vault = await Ui.select(
                    "Which vault?",
                    vaults.map((vault) => ({ value: vault, label: vault }))
                );
                keys = { kind: "1password", vault, title: `Circuit ${name.trim()} env key` };
            }
        }

        const openInEditor = Setup.installed("code") && (await Ui.confirm("Open the project in VS Code?", true));

        return { folder: name.trim(), kind, asn, git, keys, openInEditor };
    }

    /** Install Bun with its own installer, when the person agrees. */
    private static async offerBun(): Promise<void> {
        if (!(await Ui.confirm("Bun is not installed. Install it now, with Bun's own installer from bun.sh?", true))) {
            Ui.fail("A full install needs Bun. Install it from https://bun.sh, or pick Simple.");
        }

        const windows = process.platform === "win32";
        const result = windows
            ? spawnSync("powershell", ["-NoProfile", "-Command", "irm bun.sh/install.ps1 | iex"], { stdio: "inherit" })
            : spawnSync("sh", ["-c", "curl -fsSL https://bun.sh/install | bash"], { stdio: "inherit" });
        if (result.status !== 0) Ui.fail("Bun's installer did not finish. Install Bun from https://bun.sh, then run this again.");
    }

    /** Write the project's files, then git, the package and the editor, as `setup` says. */
    static async create(setup: ProjectSetup): Promise<string> {
        const root = resolve(process.cwd(), setup.folder);

        await Ui.step("Writing the project", async () => {
            mkdirSync(join(root, "sites"), { recursive: true });
            mkdirSync(join(root, "tenants"), { recursive: true });

            writeFileSync(
                join(root, "circuit.ts"),
                `// The network: its AS, its sites, and the checks Circuit runs on it. Each device is a file under sites/<site>/.

export const as${setup.asn} = circuit({
    asn: ${setup.asn},
    // Each site by its name, such as "jakarta-1": { description: "Jakarta, rack 12" }. Its devices go in sites/jakarta-1/.
    sites: {},
    checks: {
        exports_end_in_reject: true,
        imports_end_in_accept_or_reject: true,
    },
});
`
            );
            writeFileSync(
                join(root, "sites", "README.md"),
                "One folder per site, named as in circuit.ts, with one file per device: sites/<site>/<device>.ts.\n"
            );
            writeFileSync(
                join(root, "tenants", "README.md"),
                "What tenants share with your devices, one file each, merged in `tenants/index.ts`.\n"
            );
            writeFileSync(join(root, ".gitignore"), GITIGNORE);
            writeFileSync(join(root, "tsconfig.json"), EditorTypes.TSCONFIG);
            EditorTypes.write(root);
            writeFileSync(join(root, ".circuit", "README.md"), GENERATED_README);
            EnvFile.create(root, setup.keys);

            if (setup.kind === "full") {
                writeFileSync(
                    join(root, "package.json"),
                    `${JSON.stringify({ name: setup.folder.toLowerCase().replace(/[^a-z0-9-]+/g, "-"), private: true, devDependencies: {} }, null, 4)}\n`
                );
            }
        });

        if (setup.kind === "full") {
            await Ui.step(`Adding Circuit ${VERSION} to the project with Bun`, async () => {
                const result = spawnSync("bun", ["add", "--dev", "--exact", `${Setup.PACKAGE}@${VERSION}`], {
                    cwd: root,
                    encoding: "utf8",
                    shell: process.platform === "win32",
                });
                if (result.status !== 0) throw new Error(`bun add failed: ${(result.stderr || result.stdout).trim()}`);
            });
        }

        if (setup.git) {
            await Ui.step("Starting the git repository", async () => {
                GitHooks.init(root);
                GitHooks.install(root);
            });
        }

        if (setup.openInEditor) spawn("code", [root], { detached: true, stdio: "ignore", shell: process.platform === "win32" }).unref();

        return root;
    }

    /** The steps after a new project, for the person to follow. */
    static nextSteps(root: string, setup: ProjectSetup): string {
        const keyNote =
            setup.keys.kind === "file"
                ? "The key that decrypts .env is in .env.keys: keep a copy in your password manager, and share it with your team there."
                : "The key that decrypts .env is in 1Password. Your team reads it from there.";

        return [
            `cd ${setup.folder}`,
            "Add a site in circuit.ts, then a device in sites/<site>/<device>.ts. Your editor completes each field.",
            "circuit secret set NAME  a secret, such as a device password, encrypted",
            "circuit validate         check the project",
            "circuit diff <device>    what would change on the device",
            "circuit apply <device>   make the device match",
            "",
            keyNote,
            `Read more at https://circuit.tako.id. Project: ${root}`,
        ].join("\n");
    }

    /** The whole of a new project: ask, create, and say what is next. */
    static async run(folder?: string): Promise<void> {
        // In a project already, such as a fresh clone: set it up as it is, with no questions.
        const here = resolve(process.cwd(), folder ?? ".");
        if (existsSync(join(here, "circuit.ts"))) {
            await Setup.ready(here);
            return;
        }

        if (!Ui.interactive) Ui.fail("Starting a project asks a few questions, so it needs a terminal.");

        const setup = await Setup.ask(folder);
        const root = await Setup.create(setup);

        Ui.note(Setup.nextSteps(root, setup), "Next");
        Ui.outro("The project is ready.");
    }

    /** Get a project Circuit did not start here ready: its editor types, its git hook, and, in a full install, its packages. */
    static async ready(root: string): Promise<void> {
        Setup.prepare(root);

        if (Setup.pinned(root)) {
            await Ui.step("Installing the project's packages with Bun", async () => {
                const result = spawnSync("bun", ["install"], { cwd: root, encoding: "utf8", shell: process.platform === "win32" });
                if (result.status !== 0) throw new Error(`bun install failed: ${(result.stderr || result.stdout).trim()}`);
            });
        }

        Ui.done(`${root} is ready. Run circuit in it.`);
    }

    /** The version pinned in a full install's package.json, if the project has one. */
    static pinned(root: string): string | undefined {
        const path = join(root, "package.json");
        if (!existsSync(path)) return undefined;

        const manifest = JSON.parse(readFileSync(path, "utf8")) as {
            devDependencies?: Record<string, string>;
            dependencies?: Record<string, string>;
        };
        return manifest.devDependencies?.[Setup.PACKAGE] ?? manifest.dependencies?.[Setup.PACKAGE];
    }
}
