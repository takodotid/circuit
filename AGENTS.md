# AGENTS.md

Circuit turns one TypeScript file per network device into that device's config. It shows what would change, then makes the device match. Each network lives in its own repo as a Circuit project.

This repo is Circuit v1. Circuit 0.x is retired on the branch `0.x`. Never use it as a reference.

## How to work

1. Don't guess. If you are not sure, ask the owner.
2. Research before you ask or build something new. Check how others already solve it, and what the industry standard is: RFCs, official docs, mature projects. Follow the standard. Circuit's own rules build on it.
3. Check the current official docs before you use an API, a setting or a tool. Never use anything deprecated.
4. Never guess what a device does. Test it on a real device first (skill `prove-on-device`).
5. Keep changes small and inside the existing structure. Do what was asked.
6. Keep no memory outside the repo. A rule goes in this file, a device surprise in its `TRAPS.md`, and open work in a GitHub issue.
7. When the owner approves a new rule or decision, add it here or to `design/decisions.md` in the same change.

## Principles

- Users are network engineers first. They know networking well, and TypeScript little.
- A beginner can write a project on day one. A large network can run on it.
- Plain data. Policies, filters, ACLs and NAT are ordered lists of `{ if, then }` rules. You can read what lands on the device in the project, in order.
- No hidden flow. Circuit has no helper that builds config. A shared value is a `literal` or a `part`, placed with `merge` or `include`. Ready-made values are data in `presets`.
- Nothing is filled in. Circuit writes no default and no description. It may warn, but never fills in. A field is written only when it has a value: no `enabled: false`, no placeholders.
- The config is the whole truth. A device runs exactly its config, and anything else is removed or reset.
- Names are written out. A name a device carries appears in the project as it is, so a text search finds it.
- Not built for one network or one vendor. Colocation, internet exchanges, transit and office networks all count. No vendor's CLI is the model.
- What Circuit ships is standard: an RFC, IANA or another published source. A network's own choices stay in its project.
- Secrets are `secret("NAME")` or `secretFile("path")`. Rendered config and plans never hold a secret value.
- An error says what to fix: the file, the line, the key, and what to write instead.
- Before you add to the language, ask: can a network engineer guess what this does from its name and arguments? If not, make it simpler.

## Layout

- `src/config/`: the language a project writes, its globals and types. A field's doc comment is its documentation. `keys.ts` lists every key as data.
- `src/model.ts`: the plain model that platforms read.
- `src/project.ts`: reads a project into the model.
- `src/checks/`: validation and the built-in checks.
- `src/platforms/<os>/`: one adapter per device OS. The only place for vendor syntax. See `src/platforms/AGENTS.md`.
- `src/core/`: addresses, secrets, cabling, registries, topology and `Utils`.
- `src/integrations/`: the targets of `circuit sync`.
- `src/transport/`: SSH and serial consoles.
- `src/cli/`: the `circuit` command.
- `src/studio/`: `circuit studio`. The page is a Vue 3 app in `src/studio/app/`, built by Vite. The graph uses Cytoscape.
- `scripts/`: the build, Studio's build, the editor types and release signing.
- `test/`: mirrors `src/`. `test/repo.test.ts` checks this repo's own rules.
- `docs/`: the website, built with VitePress. See `docs/AGENTS.md`.
- `examples/`: whole example projects. Tests check each one.
- `design/decisions.md`: the owner's decisions. They are binding.
- Generated and ignored by git: `src/cli/editor-types.generated.ts` and `src/studio/assets.generated.ts`. `bun install` and the checks write them.

## Code

- Write code to be read: clear names, one step per line, a blank line between steps.
- Platform and core code: each file exports one main class named after its job, so callers write `Address.contains(...)`. Use static methods for helpers without state. A method name doesn't repeat its class name. Small helpers go on `Utils` in `src/core/utils.ts`.
- The language in `src/config/` is functions and plain `export type`s. A project calls the functions as globals.
- Type values as tightly as you can: a literal union for a fixed set, a template literal for a shape. Use plain `string` only for free text and names.
- A project never needs a type cast (`as`, `as const`, `satisfies`, `!`). If it does, the language has a bug.
- If you add, rename or remove a key in `src/config/`, update `keys.ts` too, or `tsc` fails.
- A change to the language updates `docs/` and `examples/` in the same commit.
- No folder for a single file. File and folder names are kebab-case. Vue components are PascalCase.
- Use a well-known, maintained, small library before you write your own. Check who maintains it and what it pulls in.
- Comments are short and plain, and say why. No banners, no manual line wrapping.

## Writing

This applies to docs, UI text, comments, commit messages and replies.

- Use everyday English. Many readers have English as a second language.
- Write full sentences that say who does what. One idea per sentence, about 20 words at most.
- Use common words in their usual meaning: "tested", not "proved"; "uses", not "names". Keep the small words: if, because, so, that.
- Say each thing once, in one place, and link to it there.
- Leave out what nobody needs: inner workings a reader can't act on, history, and notes that are out of date. Git keeps the history.
- No em-dashes. No manual line wrapping.
- Examples use real providers, exchanges and vendors with their real ASNs, such as Hurricane Electric AS6939 or Cloudflare AS13335. Your own network is AS64500. Addresses come only from documentation ranges (192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24, 2001:db8::/32). A network doing something wrong, such as a hijack or a leak, uses AS64496 to AS64511.
- Write the repo in English. Reply to the owner in their language, short. A proposal comes with a sample.

## Checks

- `bun run check` runs what CI runs. It must pass before every commit.
- `bun run lint` runs Oxlint (code and deprecated APIs), Vale (writing) and knip (unused code).
- `bun run test` runs the tests, including `test/repo.test.ts`.
- The pre-commit hook runs lint, the format check, typecheck and tests. Never skip it.
- To run Circuit from the sources on a project: `cd <project> && bun <repo>/src/cli/index.ts <command>`.

## Git

- Circuit lives on `main`. Make changes on a branch.
- Use Conventional Commits in the imperative mood, lowercase: `fix(cli): keep remembered secrets for 24 hours`. The scopes are in `commitlint.config.js`.
- Each commit does one thing, holds its tests and docs, and passes the checks on its own.
- Add no co-author or "generated with" lines.
- Planned work is a GitHub issue. Use `gh`.
- Release only when the owner asks (skill `release`).
