// The repo's own rules from AGENTS.md, checked here so they hold without anyone having to remember them (decision 108).

import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";

const root = join(import.meta.dir, "../..");

/** Every file git tracks or would track, that is still on disk. */
const files = spawnSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { cwd: root, encoding: "utf8" })
    .stdout.split("\n")
    .filter((file) => file && existsSync(join(root, file)));

/** Folders whose layout a tool or format sets, not this repo. */
const SET_ELSEWHERE = [".claude/skills/", ".github/", ".vale/", "docs/public/", "examples/", "test/fixtures/"];
const setElsewhere = (path: string) => SET_ELSEWHERE.some((prefix) => `${path}/`.startsWith(prefix));

describe("layout", () => {
    test("no folder holds only one file or folder", () => {
        const children = new Map<string, Set<string>>();
        for (const file of files) {
            const parts = file.split("/");
            for (let depth = 1; depth < parts.length; depth++) {
                const folder = parts.slice(0, depth).join("/");
                children.set(folder, (children.get(folder) ?? new Set()).add(parts[depth]!));
            }
        }

        const lonely = [...children]
            .filter(([folder, inside]) => inside.size === 1 && !setElsewhere(folder))
            .map(([folder, inside]) => `${folder}/ holds only ${[...inside][0]}. Move it up a level.`);

        expect(lonely).toEqual([]);
    });

    test("file and folder names are kebab-case", () => {
        // Names that a standard or a tool sets.
        const standard = /^(README|AGENTS|TRAPS|SKILL|LICENSE|DESIGN|PRODUCT|SECURITY|CODE_OF_CONDUCT|CONTRIBUTING)(\.md)?$|^CNAME$/;
        const kebab = /^[a-z0-9]+([.-][a-z0-9]+)*$/;

        const wrong = new Set<string>();
        for (const file of files) {
            if (setElsewhere(file) && !file.startsWith("examples/")) continue;

            const name = basename(file);
            const stem = name.replace(/^\./, "").replace(/\.[^.]+$/, "");
            const vue = existsSync(join(root, dirname(file), `${stem}.vue`));
            const fine = standard.test(name) || extname(name) === ".vue" || vue || kebab.test(stem);
            if (!fine) wrong.add(`${file}: name it in kebab-case.`);

            for (const folder of dirname(file).split("/")) {
                if (folder !== "." && !kebab.test(folder.replace(/^\./, "")))
                    wrong.add(`${dirname(file)}/: name the folder ${folder} in kebab-case.`);
            }
        }

        expect([...wrong]).toEqual([]);
    });
});

describe("agent instructions", () => {
    const instructions = files.filter((file) => basename(file) === "AGENTS.md" || file.endsWith("/SKILL.md"));

    test("Claude Code reads AGENTS.md, so there is no CLAUDE.md", () => {
        // A CLAUDE.md anywhere stops Claude Code from reading AGENTS.md (decision 107).
        expect(files.filter((file) => /^CLAUDE(\.local)?\.md$/.test(basename(file)))).toEqual([]);
    });

    test("AGENTS.md files stay short", () => {
        const long = instructions
            .filter((file) => basename(file) === "AGENTS.md")
            .map((file) => ({ file, bytes: readFileSync(join(root, file)).length, most: file === "AGENTS.md" ? 9_000 : 3_000 }))
            .filter(({ bytes, most }) => bytes > most)
            .map(
                ({ file, bytes, most }) =>
                    `${file} is ${bytes} bytes, more than ${most}. Move what only one folder needs into that folder's AGENTS.md.`
            );

        expect(long).toEqual([]);
    });

    test("every path they give exists", () => {
        const missing: string[] = [];
        for (const file of instructions) {
            const text = readFileSync(join(root, file), "utf8");
            for (const [, path] of text.matchAll(/`([\w.@-]+\/[\w./@-]*)`/g)) {
                if (!path || /^[a-z]+:\/\//.test(path) || path.startsWith("@")) continue;

                const here = join(root, dirname(file), path);
                if (!existsSync(join(root, path)) && !existsSync(here))
                    missing.push(`${file}: \`${path}\` doesn't exist. Fix the path or remove it.`);
            }
        }

        expect(missing).toEqual([]);
    });

    test(".claude/settings.json uses no deprecated or removed setting", () => {
        // From https://code.claude.com/docs/en/settings-reference, checked 2026-11-17.
        const replaced: Record<string, string> = {
            includeCoAuthoredBy: "attribution",
            disableArtifact: "enableArtifact",
            keybindingFlavor: "nothing, it has no effect",
            permissionExplainerEnabled: "nothing, it was removed",
            taskOutputMaxChars: "nothing, it was removed",
            teammateDefaultModel: "nothing, it was removed",
        };
        const settings = JSON.parse(readFileSync(join(root, ".claude/settings.json"), "utf8")) as Record<string, unknown>;

        const old = Object.keys(settings)
            .filter((key) => key in replaced)
            .map((key) => `.claude/settings.json: ${key} is deprecated. Use ${replaced[key]}.`);

        expect(old).toEqual([]);
    });
});

test("GitHub Actions are pinned to a commit", () => {
    const loose: string[] = [];
    for (const file of files.filter((file) => file.startsWith(".github/workflows/"))) {
        for (const [, action, ref] of readFileSync(join(root, file), "utf8").matchAll(/uses:\s*([^\s@]+)@(\S+)/g)) {
            if (!/^[0-9a-f]{40}$/.test(ref!))
                loose.push(`${file}: ${action}@${ref}. Pin it to a commit SHA, with the version in a comment.`);
        }
    }

    expect(loose).toEqual([]);
});
