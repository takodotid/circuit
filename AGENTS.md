# AGENTS.md

Circuit turns one TypeScript file per network device into that device's config, shows what would change, then makes the device match. Each network lives in its own repo as a Circuit project. Circuit 0.x is retired on the branch `0.x`: never use it as a reference.

Tools check the mechanical rules (`bun run check`): Oxlint, Vale, knip, Prettier, `commitlint`, and `test/repo.test.ts`. Follow what they say. This file holds only what needs judgment.

## How to work

1. Don't guess. If you are not sure, ask the owner.
2. Research first: how others solve it, and the industry standard (RFCs, official docs, mature projects). Follow the standard; Circuit's rules build on it.
3. Check the current official docs before you use an API, a setting, or a tool.
4. Never guess what a device does. Test it on a real device first (skill `prove-on-device`).
5. Keep changes small and inside the existing structure. Do what was asked.
6. Keep no memory outside the repo: a rule goes here, a device surprise in its `TRAPS.md`, open work in a GitHub issue.
7. When the owner approves a new rule or decision, add it here or to `DECISIONS.md` in the same change.
8. For work with several parts, act as the orchestrator. Give each part to a subagent with a brief: context, files, and what done looks like. Run independent parts in parallel, and review every result against the owner's request before it lands.

## Principles

- Users are network engineers first. They know networking well, and TypeScript little.
- A beginner can write a project on day one. A large network can run on it.
- Plain data: policies, filters, ACLs, and NAT are ordered lists of `{ if, then }` rules, readable in order.
- No hidden flow: no helper builds config. A shared value is a `literal` or a `part`, placed with `merge` or `include`. Ready-made values are data in `presets`.
- Nothing is filled in: no default, no description, no `enabled: false`, no placeholder. Circuit may warn, never fill in.
- The config is the whole truth: a device runs exactly its config, and anything else is removed or reset.
- A name a device carries is written out in the project, so a text search finds it.
- Not built for one network or one vendor. No vendor's CLI is the model.
- What Circuit ships is standard: an RFC, IANA, or another published source. A network's own choices stay in its project.
- Secrets are `secret("NAME")` or `secretFile("path")`. Rendered config and plans never hold a secret value.
- An error says what to fix: the file, the line, the key, and what to write instead.
- A project never needs a type cast. If it does, the language has a bug.
- Before you add to the language, ask: can a network engineer guess what this does from its name and arguments? If not, make it simpler.

## Layout

- `src/config/`: the language a project writes. A field's doc comment is its documentation.
- `src/model.ts`: the plain model platforms read. `src/project.ts` reads a project into it.
- `src/checks/`, `src/core/`, `src/integrations/` (`circuit sync`), `src/transport/` (SSH and consoles), `src/cli/`.
- `src/platforms/<os>/`: one adapter per device OS, the only place for vendor syntax. See `src/platforms/AGENTS.md`.
- `src/studio/`: `circuit studio`, a Vue 3 app in `src/studio/app/`.
- `docs/`: the website. See `docs/AGENTS.md`. `examples/`: whole example projects, tested.
- `DECISIONS.md`: binding decisions.

## Code and writing

- Code: clear names, one step per line. Comments say why. They never repeat the code or git.
- Type values as tightly as you can. Use plain `string` only for free text and names.
- No hardcoded value unless it must be there; then it is a named constant.
- Use a well-known, maintained, small library before you write your own.
- A change to the language updates `docs/` in the same commit.
- Everyday English for readers with English as a second language. No filler: write only what the reader needs and can't get from the code, git, the tools, or another page. Say each thing once.
- Examples use real names with real ASNs (Hurricane Electric AS6939). Your network is AS64500; a network doing something wrong uses AS64496 to AS64511. Use RFC 1918 ranges only where the topic is a private network.
- Write the repo in English. Reply to the owner in their language, short. A proposal comes with a sample.

## Checks and git

- `bun run check` must pass before every commit. Never skip the pre-commit hook.
- Run Circuit from the sources on a copy of a project: `cd <copy> && bun <repo>/src/cli/index.ts <command>`.
- Work on a branch. Each commit does one thing and holds its tests and docs.
- Release only when the owner asks (skill `release`).
