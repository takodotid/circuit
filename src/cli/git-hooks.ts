// The git hook a project runs before each commit, whatever makes the commit: a terminal, VS Code or GitHub Desktop. The hook is a file in `.circuit/hooks`, committed with the project, that calls `circuit hook pre-commit`. git finds it through `core.hooksPath`, a setting a clone does not carry, so Circuit sets it each time it runs in a project that lacks it.

import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { EnvFile } from "../core/env-file";

export class GitHooks {
    /** Where the hooks are, in the project. */
    static readonly FOLDER = ".circuit/hooks";

    static readonly PRE_COMMIT = `#!/bin/sh
# Written by Circuit. Before each commit: no secret in plain text, no .env.keys, and a project that validates.
if ! command -v circuit >/dev/null 2>&1; then
    echo "Circuit is not installed here, so this commit was not checked and was stopped. Install Circuit: https://circuit.tako.id" >&2
    exit 1
fi
exec circuit hook pre-commit
`;

    private static git(root: string, args: string[]): { ok: boolean; out: string } {
        // `env` given, so a change to process.env reaches git: Bun passes its starting environment otherwise.
        const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8", env: process.env });
        return { ok: !result.error && result.status === 0, out: result.stdout ?? "" };
    }

    static gitInstalled(): boolean {
        return !spawnSync("git", ["--version"], { encoding: "utf8" }).error;
    }

    /** The folder is in a git repository. */
    static isRepository(root: string): boolean {
        return GitHooks.git(root, ["rev-parse", "--git-dir"]).ok;
    }

    /** Start a repository on `main`. */
    static init(root: string): void {
        if (!GitHooks.git(root, ["init", "--initial-branch=main"]).ok) throw new Error("git could not start a repository here");
    }

    /**
     * Write the hook and point git at it, in a git repository. Gives back what changed, to tell the person, or undefined when nothing did. A repository that sends its hooks elsewhere, such as to husky, is left alone.
     */
    static install(root: string): string | undefined {
        if (!GitHooks.isRepository(root)) return undefined;

        const path = join(root, GitHooks.FOLDER, "pre-commit");
        const changes: string[] = [];

        if (!existsSync(path) || readFileSync(path, "utf8") !== GitHooks.PRE_COMMIT) {
            mkdirSync(join(root, GitHooks.FOLDER), { recursive: true });
            writeFileSync(path, GitHooks.PRE_COMMIT);
            changes.push(`wrote ${GitHooks.FOLDER}/pre-commit`);
        }

        // A clone on Linux or macOS takes the file without its execute bit when it was committed from Windows.
        if (process.platform !== "win32") chmodSync(path, 0o755);

        const current = GitHooks.git(root, ["config", "--get", "core.hooksPath"]).out.trim();
        if (!current) {
            GitHooks.git(root, ["config", "core.hooksPath", GitHooks.FOLDER]);
            changes.push("git now checks each commit for secrets in plain text");
        }

        return changes.length ? changes.join(", ") : undefined;
    }

    /** Problems with what is staged: `.env.keys`, and a `.env` with a value in plain text. Empty when the commit may go on. */
    static stagedProblems(root: string): string[] {
        const staged = GitHooks.git(root, ["diff", "--cached", "--name-only", "--diff-filter=ACMR"]).out.split("\n").filter(Boolean);
        const problems: string[] = [];

        for (const file of staged) {
            const name = basename(file);

            if (name === ".env.keys") {
                problems.push(`${file} is the key that decrypts .env. Never commit it: unstage it with git restore --staged ${file}`);
                continue;
            }

            if (name !== ".env" && !name.startsWith(".env.")) continue;

            const text = GitHooks.git(root, ["show", `:${file}`]).out;
            const plain = EnvFile.plaintextIn(text);
            if (plain.length)
                problems.push(
                    `${file} holds ${plain.join(", ")} in plain text. Encrypt it with circuit secret encrypt, then stage ${file} again.`
                );
        }

        return problems;
    }
}
