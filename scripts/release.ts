// Cuts a release: bumps the version, commits, tags and pushes. The tag starts the release workflow, which publishes the package and the GitHub release.
//
//     bun run release patch | minor | major   a stable release
//     bun run release rc patch | minor | major   the first release candidate of the next such version
//     bun run release rc                       the next candidate of the current one
//     bun run release stable                   the current candidate, as a stable release

import { readFileSync, writeFileSync } from "node:fs";

type Bump = "patch" | "minor" | "major";

const BUMPS: readonly Bump[] = ["patch", "minor", "major"];

function fail(message: string): never {
    console.error(message);
    process.exit(1);
}

function run(command: string[]): string {
    const result = Bun.spawnSync(command, { stdout: "pipe", stderr: "inherit" });
    if (result.exitCode !== 0) fail(`${command.join(" ")} failed`);

    return result.stdout.toString().trim();
}

/** `1.2.3-rc.4` to its parts. */
function parse(version: string) {
    const match = /^(\d+)\.(\d+)\.(\d+)(?:-rc\.(\d+))?$/.exec(version);
    if (!match) fail(`version ${version} is neither X.Y.Z nor X.Y.Z-rc.N`);

    const [, major, minor, patch, candidate] = match;
    return {
        major: Number(major),
        minor: Number(minor),
        patch: Number(patch),
        candidate: candidate === undefined ? undefined : Number(candidate),
    };
}

function bumped(version: ReturnType<typeof parse>, bump: Bump): string {
    if (bump === "major") return `${version.major + 1}.0.0`;
    if (bump === "minor") return `${version.major}.${version.minor + 1}.0`;
    return `${version.major}.${version.minor}.${version.patch + 1}`;
}

function next(current: string, args: string[]): string {
    const version = parse(current);
    const base = `${version.major}.${version.minor}.${version.patch}`;
    const [kind, bump] = args;

    if (kind === "stable") {
        if (version.candidate === undefined) fail(`${current} is not a release candidate`);
        return base;
    }

    if (kind === "rc") {
        if (bump === undefined) {
            if (version.candidate === undefined) fail(`${current} is not a release candidate; name patch, minor or major`);
            return `${base}-rc.${version.candidate + 1}`;
        }

        if (!BUMPS.includes(bump as Bump)) fail(`unknown bump ${bump}`);
        return `${bumped(version, bump as Bump)}-rc.0`;
    }

    if (!BUMPS.includes(kind as Bump)) fail("usage: bun run release <patch|minor|major|rc [patch|minor|major]|stable>");
    if (version.candidate !== undefined) fail(`${current} is a release candidate; finish it with stable, or continue with rc`);

    return bumped(version, kind as Bump);
}

if (run(["git", "status", "--porcelain"])) fail("the working tree has changes; commit them first");
if (run(["git", "branch", "--show-current"]) !== "main") fail("releases are cut from main");

const packagePath = new URL("../package.json", import.meta.url);
const packageJson = JSON.parse(readFileSync(packagePath, "utf8")) as { version: string };

const version = next(packageJson.version, process.argv.slice(2));
const tag = `v${version}`;

packageJson.version = version;
writeFileSync(packagePath, JSON.stringify(packageJson, null, 4) + "\n");

run(["git", "add", "package.json"]);
run(["git", "commit", "-m", `chore(release): ${tag}`]);
run(["git", "tag", "-a", tag, "-m", tag]);
run(["git", "push", "--follow-tags"]);

console.log(`${tag} pushed; the release workflow publishes it.`);
