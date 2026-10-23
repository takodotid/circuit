// Cuts a release: bumps the version, commits, tags and pushes. The tag starts the release workflow, which publishes the package and the GitHub release.
//
//     bun run release patch | minor | major   a stable release
//     bun run release rc patch | minor | major   the first release candidate of the next such version
//     bun run release rc                       the next candidate of the current one
//     bun run release stable                   the current candidate, as a stable release

import { readFileSync, writeFileSync } from "node:fs";

type Bump = "patch" | "minor" | "major";

/** A version's parts. */
type Version = { major: number; minor: number; patch: number; candidate: number | undefined };

class Release {
    private static readonly BUMPS: readonly Bump[] = ["patch", "minor", "major"];

    /** Bump the version the arguments ask for, then commit, tag and push it. */
    static main(args: string[]): void {
        if (Release.run(["git", "status", "--porcelain"])) Release.fail("the working tree has changes; commit them first");
        if (Release.run(["git", "branch", "--show-current"]) !== "main") Release.fail("releases are cut from main");

        const packagePath = new URL("../package.json", import.meta.url);
        const packageJson = JSON.parse(readFileSync(packagePath, "utf8")) as { version: string };

        const version = Release.next(packageJson.version, args);
        const tag = `v${version}`;

        packageJson.version = version;
        writeFileSync(packagePath, JSON.stringify(packageJson, null, 4) + "\n");

        Release.run(["git", "add", "package.json"]);
        Release.run(["git", "commit", "-m", `chore(release): ${tag}`]);
        Release.run(["git", "tag", "-a", tag, "-m", tag]);
        Release.run(["git", "push", "--follow-tags"]);

        console.log(`${tag} pushed; the release workflow publishes it.`);
    }

    private static fail(message: string): never {
        console.error(message);
        process.exit(1);
    }

    private static run(command: string[]): string {
        const result = Bun.spawnSync(command, { stdout: "pipe", stderr: "inherit" });
        if (result.exitCode !== 0) Release.fail(`${command.join(" ")} failed`);

        return result.stdout.toString().trim();
    }

    /** `1.2.3-rc.4` to its parts. */
    private static parse(version: string): Version {
        const match = /^(\d+)\.(\d+)\.(\d+)(?:-rc\.(\d+))?$/.exec(version);
        if (!match) Release.fail(`version ${version} is neither X.Y.Z nor X.Y.Z-rc.N`);

        const [, major, minor, patch, candidate] = match;
        return {
            major: Number(major),
            minor: Number(minor),
            patch: Number(patch),
            candidate: candidate === undefined ? undefined : Number(candidate),
        };
    }

    private static bumped(version: Version, bump: Bump): string {
        if (bump === "major") return `${version.major + 1}.0.0`;
        if (bump === "minor") return `${version.major}.${version.minor + 1}.0`;
        return `${version.major}.${version.minor}.${version.patch + 1}`;
    }

    private static next(current: string, args: string[]): string {
        const version = Release.parse(current);
        const base = `${version.major}.${version.minor}.${version.patch}`;
        const [kind, bump] = args;

        if (kind === "stable") {
            if (version.candidate === undefined) Release.fail(`${current} is not a release candidate`);
            return base;
        }

        if (kind === "rc") {
            if (bump === undefined) {
                if (version.candidate === undefined) Release.fail(`${current} is not a release candidate; name patch, minor or major`);
                return `${base}-rc.${version.candidate + 1}`;
            }

            if (!Release.BUMPS.includes(bump as Bump)) Release.fail(`unknown bump ${bump}`);
            return `${Release.bumped(version, bump as Bump)}-rc.0`;
        }

        if (!Release.BUMPS.includes(kind as Bump)) Release.fail("usage: bun run release <patch|minor|major|rc [patch|minor|major]|stable>");
        if (version.candidate !== undefined) Release.fail(`${current} is a release candidate; finish it with stable, or continue with rc`);

        return Release.bumped(version, kind as Bump);
    }
}

Release.main(process.argv.slice(2));
