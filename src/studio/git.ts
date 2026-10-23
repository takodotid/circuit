// Git, for Studio's history and comparisons: the commits that changed a device, and the network as it was at another commit or branch.

import { execFile } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

/** One commit, as Studio lists it. */
export type Commit = {
    commit: string;
    short: string;
    author: string;
    /** ISO 8601, with the author's time zone. */
    date: string;
    subject: string;
};

export class Git {
    private static readonly FORMAT = "--format=%H%x1f%h%x1f%an%x1f%aI%x1f%s";

    /** The environment without git's own variables, such as GIT_DIR in a hook, which would point git at another repository than the directory's. */
    private static environment(): Record<string, string | undefined> {
        return Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")));
    }

    /** Run git in a directory, and give what it printed, or fail with what it said. */
    private static run(cwd: string, args: string[]): Promise<string> {
        return new Promise((done, fail) => {
            execFile("git", args, { cwd, env: Git.environment(), maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
                if (error) fail(new Error((stderr || error.message).trim()));
                else done(stdout);
            });
        });
    }

    private static commitsOf(text: string): Commit[] {
        return text
            .split("\n")
            .filter(Boolean)
            .map((line) => {
                const [commit = "", short = "", author = "", date = "", subject = ""] = line.split("\x1f");
                return { commit, short, author, date, subject };
            });
    }

    /** The top of the git repository the directory is in, or undefined when it is in none, or git is missing. */
    static async top(directory: string): Promise<string | undefined> {
        try {
            return (await Git.run(directory, ["rev-parse", "--show-toplevel"])).trim();
        } catch {
            return undefined;
        }
    }

    /** The latest commits that changed any of these files, relative to the directory, newest first. */
    static async history(directory: string, files: string[], limit = 50): Promise<Commit[]> {
        if (!files.length) return [];
        return Git.commitsOf(await Git.run(directory, ["log", `-n${limit}`, Git.FORMAT, "--", ...files]));
    }

    /** Branches and tags to compare with, and the latest commits. */
    static async references(directory: string): Promise<{ names: string[]; commits: Commit[] }> {
        const names = (
            await Git.run(directory, [
                "for-each-ref",
                "--count=100",
                "--sort=-committerdate",
                "--format=%(refname:short)",
                "refs/heads",
                "refs/remotes",
                "refs/tags",
            ])
        )
            .split("\n")
            .filter((name) => name && !name.endsWith("/HEAD"));

        return { names, commits: Git.commitsOf(await Git.run(directory, ["log", "-n30", Git.FORMAT])) };
    }

    /** A branch, tag or commit, as the commit it names, or undefined when it names none. Only the characters a git name can hold are accepted. */
    static async commitOf(directory: string, name: string): Promise<Commit | undefined> {
        if (!/^[A-Za-z0-9][\w./@^~-]*$/.test(name)) return undefined;

        try {
            const [commit] = Git.commitsOf(await Git.run(directory, ["log", "-n1", Git.FORMAT, `${name}^{commit}`, "--"]));
            return commit;
        } catch {
            return undefined;
        }
    }

    /**
     * Read the network as it was at a commit: check that commit out beside the project, in `.circuit/cache/`, which git ignores, gather it there with `gather`, then remove the checkout. The config is the file of that name in the same directory, `configDirectory`.
     *
     * The checkout sits inside the project, so its imports of Circuit resolve to the version installed now.
     */
    static async networkAt(
        configDirectory: string,
        configPath: string,
        commit: string,
        gather: (configPath: string) => Promise<string>
    ): Promise<string> {
        const top = await Git.top(configDirectory);
        if (!top) throw new Error("the config is not in a git repository");

        const cache = join(configDirectory, ".circuit", "cache");
        mkdirSync(cache, { recursive: true });
        writeFileSync(join(cache, ".gitignore"), "# Written by Circuit Studio: checkouts of other commits, removed once read.\n*\n");

        // A checkout left behind by a run that stopped is forgotten first.
        await Git.run(top, ["worktree", "prune"]);

        const checkout = join(cache, commit.slice(0, 12));
        // The checkout sits deep inside the project, so a long path in the repository passes the 260 characters Windows allows unless git is told otherwise.
        await Git.run(top, ["-c", "core.longpaths=true", "worktree", "add", "--detach", "--force", checkout, commit]);

        try {
            // Where the config sits inside the repository, as git says: comparing paths would trip on two spellings of one directory, such as Windows' short names.
            const prefix = (await Git.run(configDirectory, ["rev-parse", "--show-prefix"])).trim();
            return await gather(join(checkout, prefix, basename(configPath)));
        } finally {
            await Git.run(top, ["-c", "core.longpaths=true", "worktree", "remove", "--force", checkout]).catch(() => {});
        }
    }
}
