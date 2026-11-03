---
description: "How to work on Circuit itself: its checks, the example projects, this site, the Academy, new platforms and releases."
---

# Contributing

Circuit has to stay easy to learn: plain data, no hidden flow, names written out, and nothing a newcomer must memorise. The rules are in [AGENTS.md](https://github.com/takodotid/circuit/blob/v1/AGENTS.md), for people and AI agents alike.

Everyone in issues, pull requests and Discussions follows the [Code of Conduct](https://github.com/takodotid/circuit/blob/v1/CODE_OF_CONDUCT.md). A bug, a feature, a device to support or a documentation fix each has an [issue](https://github.com/takodotid/circuit/issues/new/choose); a question goes to [Discussions](https://github.com/takodotid/circuit/discussions), and a vulnerability to a [private report](https://github.com/takodotid/circuit/security/advisories/new).

## Checks

```bash
bun install
bun run check       # typecheck, tests, format, and the binary
bun run docs:dev    # this site, locally
bun run docs:build  # this site, as it is published
cd <project> && bun <circuit>/src/cli/index.ts validate   # Circuit from the sources
```

## Example projects

`examples/` holds the whole projects that [Example projects](/guide/examples) and the Academy show. A test checks that each passes the editor's types, in TypeScript 6 and 7, and `circuit validate`, so a change to the language that breaks one fails the build.

## Writing the documentation

Write for someone who may be new to networking, and whose English may be a second language:

- everyday words, short sentences, the answer first;
- steps as a numbered list, tables over paragraphs;
- a niche word explained, or linked to the [Glossary](/guide/glossary);
- real providers and exchanges in examples (Hurricane Electric AS6939, DE-CIX), documentation addresses only.

The full rules are in AGENTS.md.

Every code sample must be valid for the current code. A whole file is best included from `examples/`, so its test covers it.

## Writing an Academy lesson

[Circuit Academy](/academy/) teaches networking from the start, then Circuit. Its levels and lessons are listed in `docs/.vitepress/academy.ts`; a lesson is a page in `docs/academy/<level>/`.

1. A lesson uses only words that lessons before it taught, and explains each new one where it first appears, with `<Term means="...">word</Term>`.
2. Every lesson has something to try: a widget in `docs/.vitepress/theme/academy/widgets/`, used in the page inside `<TryIt>`, and a few `<Quiz>` questions right after the idea they check.
3. From the Elementary level on, a lesson shows its idea in Circuit, with fields that exist in `src/config/`.

## Adding a platform

A platform is one device operating system at the versions it was proved on, in `src/platforms/<name>/`, as a class that extends `Platform` from `src/platforms/platform.ts`. Another model of a platform Circuit has only needs its ports in that platform's `models.ts`. Everything a platform sends is proved on a real device first.

## Releases

A release is made on GitHub. Its workflow builds `circuit` for each system, attaches the binaries, and publishes to npm:

- **Stable** (`1.2.0`): npm tag `latest`, and the site is rebuilt.
- **Release candidate** (`1.2.0-rc.1`): npm tag `rc`. The site stays as it is.
- **Backport** (`1.9.5` after `1.16.0`): npm tag `latest-1.9`, not marked Latest on GitHub, and the site stays as it is.

Every release's checksums are signed, and Circuit installs nothing unsigned. A version with a security problem gets a GitHub security advisory; see [SECURITY.md](https://github.com/takodotid/circuit/blob/v1/SECURITY.md). Every `circuit` learns about new versions from npm. An update never crosses a major version. Commits follow Conventional Commits, with a scope from `commitlint.config.js`.
