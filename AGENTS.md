# AGENTS.md

Circuit turns one TypeScript file per network device into that device's config, shows what would change, then makes the device match. It holds no real network: each network lives in its own repo, as a Circuit project.

This is Circuit v1, a rewrite of the config language, on the branch `v1`. It is not released: versions are `1.0.0-rc.N` until it is stable. Circuit 0.x is on `main`.

## Principles

Every change to Circuit is weighed against these, set by the owner.

- **Its users are network engineers first.** Most know networking well and programming, TypeScript above all, little. Never assume the reverse.
- **Easy to start, and it scales.** A beginner reads and writes a project on day one; a professional runs a large network on it.
- **Simple and clean, never too abstract.** No helper, class or magic that hides what a device gets. Few functions; data first.
- **Not only colocation.** Internet exchanges, IP transit, partial transit, office networks and any other kind of network are users too. Nothing is shaped after one network alone.
- **What Circuit ships is standard.** An RFC, IANA or another published source. A network's own choices stay in its project, unless they are worth sharing as such.
- **Nothing is filled in silently.** A value only Circuit uses is written explicitly, such as `bgpNeighbors()`. Circuit writes no default the project didn't write (decision 12).

## Where things are

- `src/config/`: the language, what a project writes: the globals (`circuit`, `part`, `merge`, `literal`, `secret`, `secretFile`, `bgpNeighbors`, `presets`, `address`) and every type. A field's doc comment is its documentation. `circuit.d.ts` declares the globals; `keys.ts` holds every key as data, checked against the types.
- `src/model.ts`: the model the platforms read: the config's types with plain names.
- `src/project/`: reads a project: imports `circuit.ts` and each device file, checks what the types can't, and resolves the shorthands into the model.
- `src/checks/`: validation and Circuit's built-in checks, on the model.
- `src/platforms/<name>/`: one adapter per device OS (`routeros`, `vrp`, `raisecom-ros`, `junos`, `fortios`), the only place for vendor syntax. Its `models.ts` lists the models and their ports; its `TRAPS.md` lists what the device does that you wouldn't expect.
- `src/core/`: addresses, secrets, cabling, registries, the network as a graph (`topology.ts`), and `Utils`.
- `src/transport/`: SSH and serial consoles.
- `src/cli/`: the `circuit` command: its menu and commands (`index.ts`), the commands that read a project (`project-commands.ts`), `secret` (`secret.ts`), a new project (`setup.ts`), `rename` (`rename.ts`), `migrate`, a 0.x project written again in v1 (`migrate.ts`, which also holds the 0.x-to-v1 device conversion), the git hook (`git-hooks.ts`), updates from the npm registry (`releases.ts`), the install location and `uninstall` (`app.ts`), each project's pinned version in `.circuit/version` (`versions.ts`), `fmt` (`format.ts`, Prettier inside Circuit), and how it talks to a person (`ui.ts`, with `@clack/prompts`). `editor-types.generated.ts` is written by `scripts/editor-types.ts`: the files Circuit puts in a project's `.circuit/types`.
- `src/core/env-file.ts`: a project's `.env`, each value encrypted as dotenvx encrypts it (`@dotenvx/primitives`).
- `src/studio/`: `circuit studio`. The server (`server.ts`) reads the project in a new Circuit process (`circuit studio-data`, `data.ts`), so it is always fresh, and serves the page. The page is a Vue 3 app in `app/`, built by Vite (`scripts/studio.ts`) and carried in the binary as `assets.generated.ts`, which git ignores and `bun install`, `bun run check` and `bun run build` write. The graph is drawn with Cytoscape. `types.ts` is what the server sends the page.
- `scripts/`: `build.ts` makes `dist/circuit` (`circuit.exe` on Windows); `studio.ts` builds Studio's page; `from-v0.ts` moves a 0.x device into the v1 model.
- `test/`: `test/platforms/<platform>-golden.test.ts` prove each platform renders 0.x's examples (moved to v1 by `scripts/from-v0.ts`, kept in `test/fixtures/v0/`) byte for byte as 0.x did. `test/project/examples.test.ts` writes them as a v1 project and checks the editor's types take every one. `test/platforms/fake-ssh.ts` is a fake device over SSH.
- `docs/`: the documentation site, built with VitePress (`bun run docs:dev`, `bun run docs:build`): `guide/` (install, writing a project, the `circuit` command, secrets), `studio/`, `academy/` (Circuit Academy), `platforms/`, and `reference/model.md` (the model). The installers are `docs/public/install` and `docs/public/install.ps1`, served at circuit.tako.id.
- `design/`: not on the site. [decisions.md](design/decisions.md), the decisions that shaped v1. Its theme and diagrams are in `docs/.vitepress/theme/`, following `DESIGN.md` of Circuit 0.x.
- `examples/`: whole example projects the docs and the Academy show; `test/project/example-projects.test.ts` checks each with TypeScript 6 and 7 and `circuit validate`.

- `DESIGN.md` (the look of the site and Studio), `PRODUCT.md` (who Circuit is for), `DEPLOYMENT.md` (branches and releases), `.claude/skills/` (implement, fix and prove a device; release).

Not in v1 yet: see the open issues (`gh issue list`), such as YAML projects (#167), `circuit sync` (#170) and the remaining 0.x commands (#171).

## Rules

1. The config is the whole truth: a device runs exactly its config; anything else is removed or reset.
2. Examples name real providers, exchanges and vendors that engineers know, with their real ASNs (Hurricane Electric AS6939, Cogent AS174, DE-CIX, Cloudflare AS13335). Your own network in an example is AS64500. Addresses are documentation ranges only (RFC 5737, RFC 3849: 192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24, 2001:db8::/32), so nobody copies someone else's space. Never show a real network doing something wrong, such as a hijack or a leak: use AS64496 to AS64511 there. No one's real config, addresses or policies.
3. A field is written only when it has a value. No `enabled: false`, no placeholders, nothing marked spare. Off means the field isn't there.
4. Every field in `src/config/` has a doc comment, shown on hover.
5. A field a platform can't express goes in its `unsupported()`. Never skip one silently.
6. Secrets are `secret("NAME")` or `secretFile("path")` references. Rendered config and plans never hold a value. In `.env`, each value is encrypted, or an `op://` reference; the key that decrypts is never committed.
7. A platform is one OS at the versions in its `os.versions` (`routeros` is RouterOS 7, not 6). A new version gets a wider `os.versions` once proved on it, or its own platform if it takes other commands.
8. Never guess what a device does. Prove it on a real device, and write what you learned in its `TRAPS.md`.
9. When unsure, ask.
10. When the owner approves a new rule or decision, add it here, or to [design/decisions.md](design/decisions.md) with the next number, in the same change.
11. Easy to learn beats clever. Someone who knows networking but not Circuit, and not any one vendor, must understand a project, and Circuit's own code, on first read. See "Easy to learn" below.

## Easy to learn

Circuit is declarative config for networks in general, across vendors. Keep what a user has to learn and remember small:

- **Plain data.** Policies, filters, ACLs and NAT are ordered lists of rules, each `{ if, then }`. What lands on the device can be read in the project, in order.
- **No hidden flow.** Circuit gives no helper that builds config. What many devices share is a value written once (`literal`) or a part (`part`), placed with `merge` or `include`. Ready-made values are data in `presets`.
- **Names written out.** A name a device carries is written literally in the project, so a search finds it. No naming patterns, placeholders or precedence rules to learn.
- **Not opinionated.** Give building blocks, not a naming scheme. Tenants, upstreams and customers are the project's own idea. No vendor's CLI or GUI is the model.
- **Nothing filled in.** Circuit writes no default and no description. It may warn, never fill in.
- **Errors say what to fix.** A wrong project names the file, the line, the key, and what to write instead ("Did you mean").
- **Before adding to the language, ask:** can a network engineer guess what this does from its name and arguments alone? If not, make it simpler.

## Code

- Platform and core code keeps 0.x's classes. A file exports one main class named after its job; callers write `Address.contains(...)`. Static methods for helpers without state, an instance when calls share state or the same arguments, constants as `static readonly`. A method name doesn't repeat its class.
- A class in a platform folder starts with the platform's name (`RouterOsRender`), so no two modules export the same generic name.
- The config language (`src/config/`) is functions by design: a project calls them as globals. Types stay plain `export type`.
- Type values as tightly as is practical, so the editor suggests them and refuses a wrong one: a literal union for a fixed set, a template literal for a shape (`Prefix`, `StandardCommunity`). Plain `string` only for free text and names.
- A key added to, renamed in or removed from a type in `src/config/` changes `keys.ts` too, or `tsc` fails.
- Use a well-known, maintained, small library before writing your own (`commander` for the CLI, `ssh2`). Check who maintains it, how widely it's used and what it pulls in.
- No folder for a single file, and no file for a tiny helper: small stand-alone helpers go on `Utils` in `src/core/utils.ts`.
- Code is written to be read: names that say what a value is, one step per line, a blank line between steps, an object with several fields spread over lines (Prettier keeps it when there's a newline after `{`). A platform stays in its own few files. Comments are short and plain, never decorative.

## Writing

Docs, comments, commit messages and replies to the owner:

- Dead simple: everyday words and verbs, the answer first, steps as a numbered list, no filler. Write it the way you'd tell a coworker.
- Many readers have English as a second language. Thing first, then what it does: "`access_vlan` says which VLAN the port is in", not "denotes the VLAN to which the port belongs". Skip words that need decoding: names (as a verb), denotes, specifies, designates, whereby.
- English in the repo; reply to the owner in their language. No em-dashes, no manual line wrapping, no person or vendor named unless needed.
- Say each thing once and link to it. Delete what isn't needed; git keeps history.
- Replies and deliverables to the owner are short. A proposal about the language or the code comes with a sample (decision 21).
- Every code sample in the docs is valid for the current code. A change to the language updates `docs/guide/` and `docs/reference/model.md`, and the example projects, in the same commit. A whole file in the docs is included from `examples/`, so its test covers it.

## Checks and tools

- `bun run check` runs typecheck, tests and the build. The pre-commit hook runs `bun run typecheck` and `bun run test`.
- `bun run build` writes `src/cli/editor-types.generated.ts` from the sources, builds Studio's page (`bun run studio`), then compiles `dist/circuit` (`dist/circuit.exe` on Windows) with Bun inside. `bun scripts/build.ts --target=bun-linux-x64` builds for another system. A test fails when `editor-types.generated.ts` is not current.
- `bun src/cli/index.ts <command> --project <folder>` runs Circuit from the sources. Circuit writes a project's `.circuit/types` when it starts the project and whenever they are not its own; `bunx tsc --noEmit -p <folder>` then checks the project as the editor does.
- A change to a platform keeps its golden test passing: every 0.x example renders as 0.x rendered it, byte for byte.

## Git and releases

- v1 lives on the branch `v1`.
- Conventional Commits, with a scope from `commitlint.config.js`: `repo`, `docs`, `config` (`src/config/` and `src/model.ts`), `project`, `checks`, `core`, `platforms`, `transport`, `cli`, `examples`, `release`.
- Each commit does one thing, holds its tests and docs, and passes typecheck and tests on its own.
- A GitHub release runs `.github/workflows/release.yml`: binaries, then npm (`latest` for stable, `rc` for a candidate). Only a stable release rebuilds the site. `[critical]` in the release title deprecates older versions of that major.
- No release until the owner says so. Releases are `1.0.0-rc.N` until stable, then `1.0.0`. Say Circuit v1 is pre-release wherever it's installed.
- Use `gh` for GitHub. Planned work is an issue; a release target is a milestone.
- License: BSL 1.1 by PT Hobimu Jadi Cuan (`LICENSE`), questions to legal@tako.id. Maintainers: Tako Network Engineering Team, noc@tako.id. Attribution stays modest: the license and the copyright line.
