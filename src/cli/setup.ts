// A new project, started by the installer or from the menu: the folder, its files, git and its hook, and the editor's types. Also what Circuit keeps current in a project each time it runs in it.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { SecretsFile } from "../core/secrets-file";
import { EditorTypes } from "./editor-types";
import { GitHooks } from "./git-hooks";
import { Ui } from "./ui";
import { Format } from "./format";
import { VERSION } from "./version";
import { Versions } from "./versions";

export const GENERATED_README = `# Do not edit

Circuit writes everything in this folder. Don't edit it by hand: change the project's own files, or use the command named below.

- \`version\`: the Circuit version this project runs. \`circuit update\` changes it. (Not in a full install: \`package.json\` pins the version.)
- \`secrets\`: the project's secrets, each value encrypted, so it is committed. Change them with \`circuit secrets\`.
- \`types/\`: what your editor reads to complete and check the project's files. Written again on each update. (Not in a full install: the types come from the package in \`node_modules\`.)
- \`hooks/\`: the git hook that checks each commit: every secret encrypted, and a project that validates.
- \`cache/\`: temporary, ignored by git.
`;

/** The notice in `.circuit`. */
export const NOTICE = "DO_NOT_EDIT.md";

export const GITIGNORE = `node_modules/
.circuit/cache/
`;

/** What a new project is set up with. */
export type ProjectSetup = {
    folder: string;
    /** Simple: the binary alone. Full: Circuit as a package in the project, its version pinned in package.json. */
    kind: "simple" | "full";
    asn: number;
    git: boolean;
    openInEditor: boolean;
};

export class Setup {
    /** The package a full install adds to the project. */
    static readonly PACKAGE = "@takodotid/circuit";

    private static installed(command: string): boolean {
        return !spawnSync(command, ["--version"], { encoding: "utf8", shell: process.platform === "win32" }).error;
    }

    /**
     * A full install's package.json, before `bun add` puts Circuit in it. Its `circuit` script is what `bun circuit` runs: with no
     * script of that name, Bun runs the project's own circuit.ts instead of the package's `circuit`.
     */
    static packageJson(folder: string): string {
        const name = folder.toLowerCase().replace(/[^a-z0-9-]+/g, "-");
        return `${JSON.stringify({ name, private: true, scripts: { circuit: "circuit" }, devDependencies: {} }, null, 4)}\n`;
    }

    /** Circuit installed in the project as a package, by a full install: the file to run it from. */
    static localCircuit(root: string): string | undefined {
        const path = join(root, "node_modules", ...Setup.PACKAGE.split("/"), "src", "cli", "index.ts");
        return existsSync(path) ? path : undefined;
    }

    /** What Circuit keeps current in a project, each time it runs in it: the editor's types, the git hook, and a warning for a secret in plain text. */
    static prepare(root: string): void {
        const full = Boolean(Setup.pinned(root));

        // A full install's editor reads the types from the package in node_modules.
        if (!full && !EditorTypes.current(root)) {
            EditorTypes.write(root);
            Ui.done(`Wrote the editor types for Circuit ${VERSION}.`);
        }
        Setup.writeNotice(root);

        const hooks = GitHooks.install(root);
        if (hooks) Ui.done(`${hooks[0]!.toUpperCase()}${hooks.slice(1)}.`);

        if (!full && !Versions.pinned(root)) {
            Versions.pin(root, VERSION);
            Ui.done(`Pinned this project to Circuit ${VERSION} in ${Versions.FILE}. Commit it.`);
        }

        const plain = SecretsFile.at(root).plaintext();
        if (plain.length)
            Ui.warn(`${SecretsFile.DEFAULT} holds ${plain.join(", ")} in plain text. Run circuit secrets encrypt before you commit.`);
    }

    /** Ask how to set up a new project, then set it up. */
    static async ask(folder?: string, chosen?: ProjectSetup["kind"]): Promise<ProjectSetup> {
        Ui.intro("A new Circuit project");

        const name =
            folder ??
            (await Ui.text("Project folder", {
                // An empty folder takes the project itself; elsewhere, a new folder in it.
                initial: readdirSync(process.cwd()).length ? "network" : ".",
                check: (value) => {
                    if (!value.trim()) return "Type a folder name.";
                    const path = resolve(process.cwd(), value.trim());
                    return existsSync(path) && readdirSync(path).length ? "That folder already holds files. Pick another." : undefined;
                },
            }));

        const kind =
            chosen ??
            (await Ui.select<ProjectSetup["kind"]>("How should this project run Circuit?", [
                { value: "simple", label: "Simple (recommended)", hint: "the circuit app, its version pinned in .circuit/version" },
                { value: "full", label: "Full", hint: "Circuit as a package in the project, run with bun circuit" },
            ]));

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

        const openInEditor = Setup.installed("code") && (await Ui.confirm("Open the project in VS Code?", true));

        return { folder: name.trim(), kind, asn, git, openInEditor };
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
            writeFileSync(join(root, "tsconfig.json"), setup.kind === "full" ? EditorTypes.TSCONFIG_FULL : EditorTypes.TSCONFIG);
            Setup.writeEditor(root);
            if (setup.kind === "simple") Versions.pin(root, VERSION);
            if (setup.kind === "simple") EditorTypes.write(root);
            Setup.writeNotice(root);

            if (setup.kind === "full") writeFileSync(join(root, "package.json"), Setup.packageJson(setup.folder));
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
        const run = setup.kind === "full" ? "bun circuit" : "circuit";
        return [
            ...(setup.folder === "." ? [] : [`cd ${setup.folder}`]),
            "Add a site in circuit.ts, then a device in sites/<site>/<device>.ts. Your editor completes each field.",
            `${run} secrets          your secrets, such as a device password, each encrypted`,
            `${run} validate         check the project`,
            `${run} diff <device>    what would change on the device`,
            `${run} apply <device>   make the device match`,
            "",
            `Read more at https://circuit.tako.id. Project: ${root}`,
        ].join("\n");
    }

    /** The whole of a new project: ask, create, and say what is next. */
    static async run(folder: string | undefined, options: { existing: "ready" | "refuse"; kind?: ProjectSetup["kind"] }): Promise<void> {
        // In a project already, such as a fresh clone: set it up as it is, with no questions.
        const here = resolve(process.cwd(), folder ?? ".");
        if (existsSync(join(here, "circuit.ts"))) {
            if (options.existing === "refuse") Ui.fail(`${here} holds a project already. Pick another folder.`);
            await Setup.ready(here);
            return;
        }

        if (!Ui.interactive) Ui.fail("Starting a project asks a few questions, so it needs a terminal.");

        const setup = await Setup.ask(folder, options.kind);
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

    /** `.circuit/DO_NOT_EDIT.md`, in place of the README an older Circuit wrote there. */
    static writeNotice(root: string): void {
        mkdirSync(join(root, ".circuit"), { recursive: true });
        const path = join(root, ".circuit", NOTICE);
        if (!existsSync(path) || readFileSync(path, "utf8") !== GENERATED_README) writeFileSync(path, GENERATED_README);
        rmSync(join(root, ".circuit", "README.md"), { force: true });
    }

    /** The editor's settings: the style in `.editorconfig`, which the Prettier extension and `circuit fmt` both read, and format on save in VS Code. A file the project has already is kept. */
    static writeEditor(root: string): void {
        const json = (value: unknown) => `${JSON.stringify(value, null, 4)}\n`;
        const files: Record<string, string> = {
            ".editorconfig": Format.EDITORCONFIG,
            ".vscode/settings.json": json({
                "editor.formatOnSave": true,
                "prettier.useEditorConfig": true,
                "[typescript]": { "editor.defaultFormatter": "esbenp.prettier-vscode" },
                "[json]": { "editor.defaultFormatter": "esbenp.prettier-vscode" },
                "files.eol": "\n",
            }),
            ".vscode/extensions.json": json({ recommendations: ["esbenp.prettier-vscode"] }),
        };

        for (const [file, text] of Object.entries(files)) {
            const path = join(root, file);
            if (existsSync(path)) continue;
            mkdirSync(join(path, ".."), { recursive: true });
            writeFileSync(path, text);
        }
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
