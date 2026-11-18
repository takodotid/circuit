---
description: "How to report a bug, ask a question, or fix and add to these docs and the Academy."
---

# Contributing

Everyone in issues, pull requests, and Discussions follows the [Code of Conduct](https://github.com/takodotid/circuit/blob/main/CODE_OF_CONDUCT.md).

| You want to                                  | Go to                                                                                                   |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Report a bug, or ask for a feature or device | [Open an issue](https://github.com/takodotid/circuit/issues/new)                                        |
| Ask a question                               | [Discussions](https://github.com/takodotid/circuit/discussions)                                         |
| Report a vulnerability                       | A [private report](https://github.com/takodotid/circuit/security/advisories/new). Never a public issue. |
| Change Circuit's code                        | [CONTRIBUTING.md](https://github.com/takodotid/circuit/blob/main/CONTRIBUTING.md)                       |

In a bug report, give the Circuit version (`circuit --version`) and the device platform, such as RouterOS 7.23. Say what you ran, what you expected, and what happened. Use documentation addresses, and leave out real passwords and keys.

## Fix the docs

Use **Edit this page** at the bottom of a page. To see the site on your computer, run `bun install`, then `bun run docs:dev`.

- Write as [AGENTS.md](https://github.com/takodotid/circuit/blob/main/AGENTS.md#writing) says.
- A word a reader may not know is explained where it first appears, or linked to the [Glossary](/reference/glossary).
- Every code sample works with the current code. A whole project file comes from `examples/`, so a test checks it.

## Write an Academy lesson

The levels and lessons of [Circuit Academy](/academy/) are listed in `docs/.vitepress/academy.ts`. Each lesson is a page in `docs/academy/<level>/`.

1. A lesson uses only words that earlier lessons taught. It explains each new word where it first appears, with `<Term means="...">word</Term>`.
2. Every lesson has something to try: a widget from `docs/.vitepress/theme/academy/widgets/` inside `<TryIt>`. A few `<Quiz>` questions follow right after the idea they check.
3. From the Elementary level on, a lesson shows its idea in Circuit, with fields that exist in `src/config/`.
