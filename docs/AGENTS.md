# Docs

The website, built with VitePress. Run `bun run docs:dev` to work on it and `bun run docs:build` to build it. The look is in `DESIGN.md`. The theme and its components are in `docs/.vitepress/theme/`.

- Each topic has one page. Other pages link to it and don't repeat it.
- Every code sample works with the current code. A whole project file shown here is included from `examples/`, so its test covers it.
- `bun run lint:prose` checks the writing. The Academy is checked too, but only with warnings until it is rewritten.
- The installers are `docs/public/install` and `docs/public/install.ps1`. The site serves them at circuit.tako.id.
