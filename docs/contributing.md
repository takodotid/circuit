---
description: How to work on Circuit itself, beside a network project, with its checks, templates, documentation, new platforms and releases.
---

# Contributing

## Working on Circuit beside a network

Link the working copy into the network's project, so a change here is live there without a release:

```bash
cd circuit && bun link
cd ../my-network && bun link @takodotid/circuit
```

The `circuit` command runs from `dist/`, so run `bun run build` in Circuit after a change. `bun install` in the network's project puts it back on the exact version in that project's `package.json`.

## Checks

```bash
bun run check       # everything CI runs: typecheck, tests, format, this site, the Node build
bun run test        # every example and template validates, and plans nothing against its own render
bun run docs:dev    # this site, locally
```

Before a refactor, `bun scripts/golden.ts save`; after it, `bun scripts/golden.ts check` says whether any command prints something different on any example.

## Templates

`templates/` has what `circuit new` copies: one directory per pattern, and `project/` with what every project gets. The pattern pages on this site show those same files, so a change to a template is a change to its page. `bun run test` validates every template with its own checks.

## Writing the documentation

Write for someone who may be new to networking, in everyday words: the answer first, a process as numbered steps, a niche word explained or linked to the [Glossary](/guide/glossary). The full rules are in [AGENTS.md](https://github.com/takodotid/circuit/blob/main/AGENTS.md#writing), for people and AI agents alike.

## Writing an Academy lesson

[Circuit Academy](/academy/) teaches networking from the start, then Circuit. Its levels and lessons are listed in `docs/.vitepress/academy.ts`, which the Academy's sidebar, its own page and the home page read; a lesson is a page in `docs/academy/<level>/`.

1. A lesson uses only words that lessons before it taught, and explains each new one where it first appears, with `<Term means="...">word</Term>` for a word a reader may want to look up.
2. Every lesson has something to try: a widget in `docs/.vitepress/theme/academy/widgets/`, used in the page by its file name inside `<TryIt>`, and a few `<Quiz>` questions placed right after the idea they check.
3. Widgets draw devices with `<SvgDevice>`, move packets with `useTravel()`, and use the shared controls in `academy.css`, so every lesson looks and behaves alike.
4. From the Elementary level on, a lesson shows its idea in Circuit, with fields that exist in the [schema](/reference/schema).

A lesson's place in its level, its "mark it done" box and its discussion are added by the layout; the page has only the lesson.

## Adding a platform

A platform is one device operating system at the versions it was proved on, in `src/platforms/<name>/`, as a class that extends `Platform` from `src/platforms/platform.ts`. Another model of a platform Circuit has only needs its ports in that platform's `models.ts`.

The steps, from the model catalog to the docs, are in the [implement-device checklist](https://github.com/takodotid/circuit/blob/main/.claude/skills/implement-device/SKILL.md). Everything a platform sends is proved on a real device first, the safe way for each platform; see [prove-on-device](https://github.com/takodotid/circuit/blob/main/.claude/skills/prove-on-device/SKILL.md). Both are also skills an AI agent working in the repository loads by itself.

## Releases

Every change is a branch and a pull request; a release is cut from `main` only after the work in it is merged and accepted, with `bun run release`. [DEPLOYMENT.md](https://github.com/takodotid/circuit/blob/main/DEPLOYMENT.md) has the whole path. Commits follow Conventional Commits with a scope from `commitlint.config.js`.
