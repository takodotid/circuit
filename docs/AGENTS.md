# Docs

The website, built with VitePress: `bun run docs:dev` and `bun run docs:build`. The look is in `DESIGN.md`, and the theme in `docs/.vitepress/theme/`.

- Each topic has one page. Other pages link to it and don't repeat it.
- Every code sample works with the current code. A whole project file shown here is included from `examples/`, so its test covers it.
- The installers are `docs/public/install` and `docs/public/install.ps1`. The site serves them at circuit.tako.id.
