# AGENTS.md

Circuit turns one TypeScript file per network device into that device's config, shows what would change, then makes the device match. It holds no real network: each network lives in its own repo and depends on Circuit.

## Where things are

- `src/schema/`: the vendor-neutral model, types only. A field's doc comment is its documentation.
- `src/core/`: the config DSL (`define.ts`), validation, address math, secrets, topology.
- `src/platforms/<name>/`: one adapter per device OS (`routeros`, `vrp`, `junos`, `fortios`, `raisecom-ros`), the only place for vendor syntax. Its `TRAPS.md` lists what the device does that you wouldn't expect.
- `src/transport/` SSH and serial consoles. `src/integrations/` PeeringDB, LibreNMS, NetBox, Prometheus, registries. `src/helpers/` ready-made filters, BGP policy and checks (`@takodotid/circuit/helpers`).
- `src/cli/` the `circuit` command. `src/studio/` Circuit Studio: a server, and `public/`, plain browser JavaScript typed with JSDoc, no build. The server reads `public/` from the package's `src/` under Bun and Node alike; a saved file reloads an open page.
- `examples/`: `platforms/` has one device per platform using every field its adapter supports, `use-cases/` has whole networks. `templates/` is what `circuit new` copies (a folder per pattern, `project/` for every project). `test/` checks both.
- `docs/` is circuit.tako.id (VitePress). Pages include `templates/` files and each `TRAPS.md`: never copy them into a page.

## Rules

1. The config is the whole truth: a device runs exactly its config; anything else is removed or reset.
2. No real network's names, addresses or policies in this repo.
3. A field is written only when it has a value. No `enabled: false`, no placeholders, nothing marked spare. Off means the field isn't there.
4. Every schema field has a doc comment, shown on hover.
5. A field a platform can't express goes in its `unsupported()`. Never skip one silently.
6. Secrets are `secret("NAME")` references. Rendered config, plans and snapshots never hold a value.
7. A platform is one OS at the versions in its `os.versions` (`routeros` is RouterOS 7, not 6). A new version gets a wider `os.versions` once proved on it, or its own platform if it takes other commands.
8. Never guess what a device does. Prove it (skill `prove-on-device`) and write what you learned in its `TRAPS.md`.
9. When unsure, ask.
10. When the owner approves a new rule or decision, add it here in the same change.

## Code

- Classes, not loose functions. A file exports one main class named after its job; callers write `Address.contains(...)`. Static methods for helpers without state, an instance when calls share state or the same arguments, constants as `static readonly`. A method name doesn't repeat its class.
- A class in a platform folder starts with the platform's name (`RouterOsRender`), so no two modules export the same generic name.
- Exceptions: the config DSL (`defineDevice`, `defineNetwork`, `secret`, `secretFile`) stays as functions; Vue components and composables (`useX`) follow Vue. Types stay plain `export type`.
- Type values as tightly as is practical, so the editor suggests them and refuses a wrong one: a literal union for a fixed set, a template literal for a shape (`Prefix`, `StandardCommunity`). Plain `string` only for free text and names.
- Use a well-known, maintained, small library before writing your own (`commander` for the CLI, `yaml`, `@clack/prompts`). Check who maintains it, how widely it's used and what it pulls in, and that it runs on Node 22.12 and Bun.
- Node.js: `engines` is the oldest version Circuit promises, and CI checks on it (fixed) and on the newest LTS (Renovate keeps it current; only even majors). Don't let Renovate move the oldest. Raise `engines`, README, getting started and that CI entry together, at the latest when the oldest line leaves support (Node 22: 2027-04-30). `release.yml` publishes with a current LTS patch.
- No folder for a single file, and no file for a tiny helper: small stand-alone helpers go on `Utils` in `src/core/utils.ts`.
- `src/` uses Node's APIs, never Bun's. Bun runs `src/` as it is; `bun run build` bundles `dist/` for Node, npm and pnpm, where the CLI loads the config with jiti.
- Code is written to be read: names that say what a value is, one step per line, a blank line between steps, an object with several fields spread over lines (Prettier keeps it when there's a newline after `{`). A platform stays in its own few files. Comments are short and plain, never decorative.

## Writing

Docs, comments, commit messages and replies to the owner:

- Dead simple: everyday words and verbs, the answer first, steps as a numbered list, no filler. Write it the way you'd tell a coworker.
- Many readers have English as a second language. Thing first, then what it does: "`access_vlan` says which VLAN the port is in", not "denotes the VLAN to which the port belongs". Skip words that need decoding: names (as a verb), denotes, specifies, designates, whereby.
- English in the repo; reply to the owner in their language. No em-dashes, no manual line wrapping, no person or vendor named unless needed.
- Say each thing once and link to it. Delete what isn't needed; git keeps history.
- Docs pages suit someone new to networking: explain a niche word where it first matters, or link `docs/guide/glossary.md`. A change to what Circuit does updates its page in the same commit.

## Checks and tools

- `bun run check` runs what CI runs. The pre-commit hook runs `bun run typecheck` and `bun run test`.
- Each example and template plans nothing against its own render (`test/platforms/examples.test.ts`), which catches a reader and a renderer that disagree. `test/platforms/fake-ssh.ts` is a fake device over SSH, so a platform's login, read and apply run in the tests too.
- `test/package/consumer.ts` uses the built package by its name with `nodenext`, so the published types must resolve for any project, not only this repo.
- Refactor: `bun scripts/golden.ts save` before, `check` after. Every CLI output on every example must match.
- Skills in `.claude/skills/`: `implement-device`, `fix-device`, `prove-on-device`, `release`.
- `bun scripts/lab.ts` reads, plans, applies one device file on a real device, or sends it raw lines. `bun scripts/shots.ts` screenshots the docs site or Studio and reports console errors.
- Third-party skills (antislop, impeccable) aren't committed: `bun run agents:setup` installs them from `skills-lock.json`. Design work reads `PRODUCT.md` and `DESIGN.md`.

## Git and releases

- A change goes on its own branch and pull request, unless it touches only docs or repo meta files (`DEPLOYMENT.md`).
- Conventional Commits, scope from `commitlint.config.js`. Each commit does one thing, holds its tests and docs, and passes typecheck and tests on its own.
- Release only accepted work on `main` (skill `release`). Circuit is alpha until 1.0.0: say so wherever it's installed.
- Use `gh` for GitHub. Planned work is an issue; a release target is a milestone.
- License: BSL 1.1 by PT Hobimu Jadi Cuan (`LICENSE`), questions to legal@tako.id. Maintainers: Tako Network Engineering Team, noc@tako.id. Attribution stays modest: the license, the copyright line, the credits page.
