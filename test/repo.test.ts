// The repo's own rules from AGENTS.md, checked here so they hold without anyone having to remember them (decision 108).

import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { Address } from "../src/core/address";

const root = join(import.meta.dir, "..");

/** Every file git tracks or would track, that is still on disk. */
const files = spawnSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { cwd: root, encoding: "utf8" })
    .stdout.split("\n")
    .filter((file) => file && existsSync(join(root, file)));

/** Folders whose layout a tool or format sets, not this repo. */
const SET_ELSEWHERE = [".claude/skills/", ".github/", ".vale/", "docs/public/", "examples/", "test/fixtures/"];
const setElsewhere = (path: string) => SET_ELSEWHERE.some((prefix) => `${path}/`.startsWith(prefix));

const read = (file: string) => readFileSync(join(root, file), "utf8");

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
        const standard =
            /^(README|AGENTS|TRAPS|SKILL|LICENSE|DESIGN|DECISIONS|PRODUCT|SECURITY|CODE_OF_CONDUCT|CONTRIBUTING)(\.md)?$|^CNAME$/;
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
            .map((file) => ({ file, bytes: readFileSync(join(root, file)).length, most: file === "AGENTS.md" ? 9000 : 3000 }))
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
            const text = read(file);
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
        const settings = JSON.parse(read(".claude/settings.json")) as Record<string, unknown>;

        const old = Object.keys(settings)
            .filter((key) => key in replaced)
            .map((key) => `.claude/settings.json: ${key} is deprecated. Use ${replaced[key]}.`);

        expect(old).toEqual([]);
    });
});

test("GitHub Actions are pinned to a commit, and Docker images to a digest", () => {
    const loose: string[] = [];
    for (const file of files.filter((file) => file.startsWith(".github/workflows/"))) {
        for (const [, uses] of read(file).matchAll(/uses:\s*(\S+)/g)) {
            if (uses!.startsWith("./")) continue;
            if (uses!.startsWith("docker://")) {
                if (!/:[^/@]+@sha256:[0-9a-f]{64}$/.test(uses!))
                    loose.push(`${file}: ${uses}. Pin it to a tag and its digest, as docker://image:tag@sha256:<digest>.`);
            } else if (!/@[0-9a-f]{40}$/.test(uses!)) {
                loose.push(`${file}: ${uses}. Pin it to a commit SHA, with the version in a comment.`);
            }
        }
    }

    expect(loose).toEqual([]);
});

// A page shows part of an example as a region, `<<< @/../examples/<file>#<name>`, so the excerpt can't drift from the file. VitePress shows the whole file when the region is missing, so each one is checked here, and each region in an example is one a page shows.
test("every region a page includes is in its example, and every region is included", () => {
    const included = new Set<string>();
    const wrong: string[] = [];

    for (const page of files.filter((file) => file.startsWith("docs/") && file.endsWith(".md"))) {
        for (const [, path, name] of read(page).matchAll(/^<<< @\/\.\.\/(\S+?)#([\w-]+)\s*$/gm)) {
            included.add(`${path}#${name}`);
            const text = existsSync(join(root, path!)) ? read(path!) : "";
            if (!text.includes(`// #region ${name}\n`) || !text.includes(`// #endregion ${name}\n`))
                wrong.push(`${page}: ${path} has no region ${name}`);
        }
    }

    for (const example of files.filter((file) => file.startsWith("examples/") && file.endsWith(".ts"))) {
        for (const [, name] of read(example).matchAll(/^\s*\/\/ #region ([\w-]+)$/gm)) {
            if (!included.has(`${example}#${name}`)) wrong.push(`${example}: region ${name} is on no page`);
        }
    }

    expect(wrong).toEqual([]);
});

describe("code", () => {
    // The language in src/config is functions and types, and Studio's page is Vue, so these rules skip them.
    const code = files.filter(
        (file) => /^src\/.+\.ts$/.test(file) && !/^src\/(config|studio\/app)\//.test(file) && !file.endsWith(".generated.ts")
    );
    const squash = (name: string) => name.replace(/[^a-z0-9]/gi, "").toLowerCase();

    /** Each class and its body, as Prettier writes them. The body ends at a `}` that starts a line and ends a paragraph. */
    const classes = (text: string) =>
        [...text.matchAll(/^(export )?(?:abstract )?class (\w+)[^\n]*?(?:\{\}$|\{\n([\s\S]*?)^\}(?=\n$))/gm)].map(
            ([, exported, name, body]) => ({
                exported: Boolean(exported),
                name: name!,
                body: body ?? "",
            })
        );

    /** The class a platform's index.ts exports, such as `RouterOs`. */
    const platformOf = (file: string) => {
        const folder = /^src\/platforms\/[^/]+\//.exec(file)?.[0];
        if (!folder) return;

        return classes(read(`${folder}index.ts`)).find((found) => found.exported)?.name;
    };

    test("a file holds classes and types, and one class is named after the file", () => {
        // A data file is the exception: a platform's hardware models, and the version the release sets.
        const data = ["models.ts", "version.ts"];

        const wrong: string[] = [];
        for (const file of code) {
            const text = read(file);
            const values = [...text.matchAll(/^(?:export )?(?:async )?(?:function|const|let|var) (\w+)\s*[=:(<]/gm)].map(
                ([, name]) => name
            );
            if (values.length && !data.includes(basename(file)))
                wrong.push(`${file}: make ${values.join(", ")} static on the file's class.`);

            const stem = basename(file) === "index.ts" ? basename(dirname(file)) : basename(file, ".ts");
            const exported = classes(text).filter((found) => found.exported);
            if (exported.length && !exported.some((found) => squash(found.name).includes(squash(stem))))
                wrong.push(`${file}: name one of ${exported.map((found) => found.name).join(", ")} after the file, ${stem}.`);
        }

        expect(wrong).toEqual([]);
    });

    test("a platform's classes start with its name", () => {
        // So no two modules export the same name: `RouterOsRender`, not `Render`.
        const wrong = code.flatMap((file) => {
            const platform = platformOf(file);
            return classes(read(file))
                .filter((found) => platform && found.exported && !found.name.startsWith(platform))
                .map((found) => `${file}: name ${found.name} ${platform}${found.name}.`);
        });

        expect(wrong).toEqual([]);
    });

    test("a member's name doesn't repeat its class's name", () => {
        // Callers write `Address.contains()`, not `Address.addressContains()`. The platform's name in a class's name doesn't count.
        const member = /^ {4}(?:(?:private|protected|public|static|readonly|async|override|abstract|get|set) )*#?(\w+)\s*[(<=:?!]/gm;

        const wrong: string[] = [];
        for (const file of code) {
            const platform = platformOf(file);
            for (const found of classes(read(file))) {
                const job = platform && found.name !== platform ? found.name.slice(platform.length) : found.name;
                const words = [squash(job), squash(job).replace(/s$/, "")].filter((word) => word.length > 2);
                for (const [, name] of found.body.matchAll(member)) {
                    if (name !== "constructor" && words.some((word) => squash(name!).includes(word)))
                        wrong.push(`${file}: ${found.name}.${name} repeats ${job}.`);
                }
            }
        }

        expect(wrong).toEqual([]);
    });

    test("the language in src/config is functions and types", () => {
        const wrong = files.filter((file) => file.startsWith("src/config/") && /^(export )?(abstract )?class /m.test(read(file)));

        expect(wrong).toEqual([]);
    });

    test("an example needs no cast", () => {
        // Oxlint refuses `as` and `!` in examples. These two it allows.
        const wrong = files.filter((file) => file.startsWith("examples/") && /\bas const\b|\bsatisfies\b/.test(read(file)));

        expect(wrong).toEqual([]);
    });

    test("each platform has its models and its traps", () => {
        const folders = [...new Set(files.filter((file) => /^src\/platforms\/[^/]+\//.test(file)).map((file) => dirname(file)))];
        const missing = folders.flatMap((folder) =>
            ["index.ts", "models.ts", "TRAPS.md"].filter((name) => !files.includes(`${folder}/${name}`)).map((name) => `${folder}/${name}`)
        );

        expect(missing).toEqual([]);
    });
});

describe("comments", () => {
    const code = files.filter(
        (file) => /\.(ts|js|mjs|vue)$/.test(file) && !file.startsWith("test/fixtures/") && !file.endsWith(".generated.ts")
    );

    /** Each comment, with its file and line: `//` lines in a row are one, as is each `/* *\/` that starts a line. */
    const comments = code.flatMap((file) => {
        const found: { file: string; line: number; lines: string[] }[] = [];
        const lines = read(file).split("\n");

        for (let index = 0; index < lines.length; index++) {
            const start = index;
            if (/^\s*\/\//.test(lines[index]!)) {
                while (index + 1 < lines.length && /^\s*\/\//.test(lines[index + 1]!)) index++;
                found.push({ file, line: start + 1, lines: lines.slice(start, index + 1).map((line) => line.replace(/^\s*\/\/ ?/, "")) });
            } else if (/^\s*\/\*/.test(lines[index]!)) {
                while (index + 1 < lines.length && !lines[index]!.includes("*/")) index++;
                const body = lines
                    .slice(start, index + 1)
                    .map((line) => line.replace(/^\s*(\/\*+|\*\/|\*)? ?/, "").replace(/\s*\*\/$/, ""));
                found.push({ file, line: start + 1, lines: body });
            }
        }

        return found.filter((comment) => !/^(#(end)?region|oxlint-|prettier-ignore|@ts-)/.test(comment.lines[0]!.trim()));
    });

    /** A comment's prose: no code blocks, each piece of inline code one word. */
    const prose = (lines: string[]) =>
        lines
            .join("\n")
            .replace(/```[\s\S]*?```/g, " ")
            .replace(/`[^`\n]*`/g, "code");

    test("no banners", () => {
        const wrong = comments
            .filter((comment) => comment.lines.some((line) => /^\s*[-=*#~_]{3,}\s*$/.test(line)))
            .map((comment) => `${comment.file}:${comment.line}`);

        expect(wrong).toEqual([]);
    });

    test("a sentence has at most 30 words", () => {
        const wrong = comments.flatMap((comment) =>
            prose(comment.lines)
                .split(/(?<=[.!?])\s+|\n\s*(?:[-*]|\d+\.)\s|\n\s*\n/)
                .filter((sentence) => (sentence.match(/[\w'-]+/g) ?? []).length > 30)
                .map((sentence) => `${comment.file}:${comment.line}: ${sentence.trim().slice(0, 60)}...`)
        );

        expect(wrong).toEqual([]);
    });

    test("a comment is short", () => {
        // A field's doc comment in src/config is its documentation, with examples, so it may be longer.
        const wrong = comments
            .map((comment) => ({ ...comment, length: prose(comment.lines).replace(/\s+/g, " ").length }))
            .filter(({ file, length }) => length > (file.startsWith("src/config/") ? 1000 : 400))
            .map(({ file, line, length }) => `${file}:${line} is ${length} characters. Say why in fewer words, or leave it out.`);

        expect(wrong).toEqual([]);
    });

    test("no manual line wrapping", () => {
        // A line that ends mid-sentence, followed by more of the sentence. Lists, code, tables, and HTML are left as they are.
        const block = /^\s*([-*+]\s|\d+\.\s|[|#>]|<|:::|```|!\[|\[[^\]]+\]:)/;
        const wrapped = (lines: string[]) => {
            let fenced = false;
            let tag = false;
            return lines.flatMap((line, index) => {
                if (/^\s*```/.test(line)) fenced = !fenced;
                if (/^\s*<[A-Za-z]/.test(line)) tag = !/>\s*$/.test(line);
                else if (tag && />\s*$/.test(line)) tag = false;

                const next = lines[index + 1];
                const ends = /[.:!?;,)`\]>]$|^\s*$/.test(line);
                const plain = (text: string) => text.trim() && !block.test(text) && !/^\s{2,}/.test(text);
                return !fenced && !tag && next !== undefined && !ends && plain(line) && plain(next) ? [index] : [];
            });
        };

        const pages = files.filter((file) => file.endsWith(".md") && !file.startsWith("test/fixtures/"));
        const wrong = [
            ...pages.flatMap((file) =>
                wrapped(
                    read(file)
                        .replace(/^---\n[\s\S]*?\n---\n/, "")
                        .split("\n")
                ).map((index) => `${file}, line ${index + 1}`)
            ),
            ...comments.flatMap((comment) => wrapped(comment.lines).map((index) => `${comment.file}:${comment.line + index}`)),
        ];

        expect(wrong).toEqual([]);
    });
});

// Samples use documentation addresses and AS numbers, as IETF's idnits asks of an Internet-Draft. A real network is written with its name.
describe("samples", () => {
    // test/fixtures/v0 holds projects converted from Circuit 0.x, kept as they were. This file and src/core/address.ts hold the rules' own data.
    const samples = files
        .filter(
            (file) =>
                /^(docs|examples|src|test)\/.+\.(md|ts|vue|json|txt|html)$/.test(file) &&
                !file.startsWith("test/fixtures/v0/") &&
                !["test/repo.test.ts", "src/core/address.ts"].includes(file)
        )
        .map((file) => ({ file, lines: read(file).split("\n") }));

    /** Each match of `patterns` in the samples, with its file, line, and the lines of its file. */
    const found = (patterns: RegExp[]) =>
        samples.flatMap(({ file, lines }) =>
            lines.flatMap((text, index) =>
                patterns.flatMap((pattern) => [...text.matchAll(pattern)].map((match) => ({ file, lines, index, match })))
            )
        );

    test("a public address is a documentation address", () => {
        const DOCUMENTATION = {
            ipv4: "192.0.2.0/24, 198.51.100.0/24, or 203.0.113.0/24 (RFC 5737)",
            ipv6: "2001:db8::/32 (RFC 3849) or 3fff::/20 (RFC 9637)",
        };
        // Real addresses a page needs, by file.
        const REAL: Record<string, string[]> = {
            // A wrong answer in a quiz: a mask is not the prefix length written four times.
            "docs/academy/beginner/ip-addresses.md": ["16.16.16.16"],
            // The prefixes of the 2008 YouTube hijack.
            "docs/academy/professional/routing-security.md": ["208.65.153.0/24", "208.65.152.0/22"],
            // Cloudflare's public resolvers, as a home router uses them.
            "examples/single-site/sites/home/router.ts": ["1.1.1.1", "1.0.0.1"],
            // Global addresses from IANA's special-purpose registries, which Address.isGlobal must find global.
            "test/core/address.test.ts": ["192.31.196.1", "192.0.0.9", "2620:4f:8000::1", "2001:1::1", "64:ff9b::c000:201"],
        };

        // An address alone, with its length if written: not part of a version number, an OID, a MAC address, or a time.
        const IPV4 = /(?<![\w.])\d{1,3}(?:\.\d{1,3}){3}(?:\/\d{1,2})?(?!\w|\.\d)/g;
        const IPV6 = /(?<![\w:.])[\da-f]*:[\da-f:]*:[\da-f]*(?:\/\d{1,3})?(?![\w:]|\.\d)/gi;

        const wrong = found([IPV4, IPV6]).flatMap(({ file, index, match: [value] }) => {
            const prefix = Address.isCidr(value) ? value : `${value.split("/")[0]}/${Address.bits(Address.family(value))}`;
            if (!Address.isCidr(prefix) || REAL[file]?.includes(value)) return [];

            const { first, last, family } = Address.range(prefix);
            const ends = [first, last].map((end) => Address.fromNumber(end, family));
            if (!ends.some((end) => Address.isGlobal(end))) return [];

            return [`${file}:${index + 1}: ${value} is a real address. Use one from ${DOCUMENTATION[family]}.`];
        });

        expect(wrong).toEqual([]);
    });

    test("a real AS number is written with its network's name", () => {
        // AS numbers no network holds, from IANA's special-purpose registry: reserved (RFC 7607, RFC 6793, RFC 7300), documentation (RFC 5398), and private use (RFC 6996).
        const UNHELD: [number, number][] = [
            [0, 0],
            [23456, 23456],
            [64496, 65551],
            [4200000000, 4294967295],
        ];
        // Real networks the samples name, as RIPEstat gave their holders on 2026-11-19. The customers are listed in docs/license.md.
        const NETWORKS: Record<number, string> = {
            174: "Cogent",
            701: "Verizon",
            1299: "Arelion",
            2906: "Netflix",
            3491: "PCCW",
            6695: "DE-CIX",
            6777: "AMS-IX",
            6939: "Hurricane Electric",
            13335: "Cloudflare",
            15169: "Google",
            17557: "Pakistan Telecom",
            20940: "Akamai",
            33154: "DQE",
            35224: "PLINQ",
            36561: "YouTube",
            41529: "MediaServe",
            54113: "Fastly",
            58477: "Argon",
            140443: "Herza",
            213050: "Nedap",
            264009: "Infix Telecom",
            328225: "Strathmore University",
            396531: "Allegheny",
        };
        // Where an AS number is written: AS6939, as6939, remote_as: 6939, peer-as 6939, and the first part of a community, 6939:666.
        const ASN = [
            /\bASN? ?(\d+)\b|\bas(\d+)\b/g,
            /\b(?:[a-z]+[._-])?asn?["']?\s*[:=]\s*(\d+)\b/g,
            /\b(?:[a-z]+-as|as-number|autonomous-system|router bgp|set as)\s+(\d+)\b/g,
            /(?<![\w:.])(\d+):\d+(?::\d+)?(?![\w:]|\.\d)/g,
        ];
        // 18:47 is a time, and Docker's `ports: ["80:80"]` maps ports.
        const notCommunity = (text: string, line: string) => /^([01]?\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(text) || /\bports:/.test(line);
        const squash = (text: string) => text.toLowerCase().replace(/[\s_-]+/g, " ");

        /** The lines around a line up to a blank line: a paragraph, a table, or a neighbor in code. */
        const blockOf = (lines: string[], index: number) => {
            const start = lines.findLastIndex((line, at) => at < index && !line.trim()) + 1;
            const end = lines.findIndex((line, at) => at > index && !line.trim());
            return squash(lines.slice(start, end === -1 ? undefined : end).join(" "));
        };

        const real = found(ASN)
            .map(({ file, lines, index, match: [text, first, second] }) => ({ file, lines, index, text, asn: Number(first ?? second) }))
            .filter(({ asn }) => !UNHELD.some(([low, high]) => asn >= low && asn <= high))
            .filter(({ lines, index, text }) => !/^\d/.test(text) || !notCommunity(text, lines[index]!));

        // Once a file names a network in the same block as its AS number, the AS number may stand alone in that file.
        const named = new Set(
            real
                .filter(({ lines, index, asn }) => NETWORKS[asn] && blockOf(lines, index).includes(squash(NETWORKS[asn])))
                .map(({ file, asn }) => `${file} ${asn}`)
        );

        const wrong = real
            .filter(({ file, asn }) => !named.has(`${file} ${asn}`))
            .map(({ file, index, asn }) =>
                NETWORKS[asn]
                    ? `${file}:${index + 1}: AS${asn} is ${NETWORKS[asn]}'s. Write the name next to it once in this file.`
                    : `${file}:${index + 1}: AS${asn} is no documentation or private AS number. Use AS64500 for your network, or one from AS64496 to AS64511 (RFC 5398) for another. For a real network, write its name next to it and add both to NETWORKS in test/repo.test.ts.`
            );

        expect(wrong).toEqual([]);
    });

    // AGENTS.md: a content provider is only a peer. This sees the tenants' files and paths to them, and a neighbor whose own object says role "customer" and remote_as. It can't see a customer in prose or in a widget's data, or a role taken from a neighbor group.
    test("a content provider is a peer, never a customer or a tenant", () => {
        const CONTENT: Record<number, string> = {
            2906: "Netflix",
            8075: "Microsoft",
            13335: "Cloudflare",
            15169: "Google",
            16509: "Amazon",
            20940: "Akamai",
            32934: "Meta",
            36561: "YouTube",
            54113: "Fastly",
            396986: "ByteDance",
        };
        const FIX = "A content provider is only a peer: name a little-known network instead, and list it in docs/license.md.";
        const names = Object.values(CONTENT).join("|");
        const inTenant = new RegExp(`\\b(?:${names})\\b|\\bremote_as:\\s*(?:${Object.keys(CONTENT).join("|")})\\b`, "gi");
        const tenantPath = new RegExp(`\\btenants/(?:${names})\\.ts\\b`, "gi");

        /** The object literal around `at` in `text`, from its `{` to its `}`. */
        const objectAround = (text: string, at: number) => {
            let start = at;
            for (let depth = 0; start > 0; start--) {
                if (text[start] === "}") depth++;
                if (text[start] === "{" && depth-- === 0) break;
            }
            let end = at;
            for (let depth = 0; end < text.length; end++) {
                if (text[end] === "{") depth++;
                if (text[end] === "}" && depth-- === 0) break;
            }
            return text.slice(start, end + 1);
        };
        const lineOf = (text: string, at: number) => text.slice(0, at).split("\n").length;

        const wrong = samples.flatMap(({ file, lines }) => {
            const text = lines.join("\n");
            const tenants = /^examples\/[^/]+\/tenants\//.test(file) ? [...text.matchAll(inTenant)] : [];
            const asTenant = [...tenants, ...text.matchAll(tenantPath)].map(
                (match) => `${file}:${lineOf(text, match.index)}: ${match[0]} is a tenant. ${FIX}`
            );
            const asCustomer = [...text.matchAll(/\brole:\s*["']customer["']/g)].flatMap((match) => {
                const asn = Number(/\bremote_as:\s*(\d+)/.exec(objectAround(text, match.index))?.[1]);
                return CONTENT[asn] ? [`${file}:${lineOf(text, match.index)}: ${CONTENT[asn]}, AS${asn}, is a BGP customer. ${FIX}`] : [];
            });
            return [...asTenant, ...asCustomer];
        });

        expect(wrong).toEqual([]);
    });

    test("a name is real, not a placeholder", () => {
        // A name that stands for another network, such as transit-a, isp1, or customer_b, and words that stand for nothing. Vale checks prose: Circuit.Placeholders.
        const PLACEHOLDER =
            /\b(?:(?:transit|customer|peer|isp|provider|upstream|downstream|carrier|member|tenant|exchange|partner)(?:[-_][a-z]|[-_]?\d+)|foo|foobar|baz|qux|quux)\b/gi;
        // Tests that use the names of the 0.x projects in test/fixtures/v0.
        const LEFT = ["test/checks/built-in.test.ts", "test/checks/v0-examples.test.ts", "test/platforms/junos-golden.test.ts"];

        const wrong = found([PLACEHOLDER])
            .filter(({ file }) => !LEFT.includes(file))
            .map(
                ({ file, index, match: [name] }) =>
                    `${file}:${index + 1}: ${name} is a placeholder. Name a real network, such as hurricane-electric for AS6939.`
            );

        expect(wrong).toEqual([]);
    });
});
