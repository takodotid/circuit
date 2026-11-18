# Docs

The website, built with VitePress: `bun run docs:dev` and `bun run docs:build`. The look is in `DESIGN.md`, and the theme in `docs/.vitepress/theme/`.

- Each topic has one page. Other pages link to it and don't repeat it.
- Every code sample works with the current code. A whole project file shown here is included from `examples/`, so its test covers it. `test/docs.test.ts` type-checks each `ts` block where its first line says it goes, such as `// edge-01.ts, in routing.bgp` or `// circuit.ts`, or else at the top level of a device.
- The installers are `docs/public/install` and `docs/public/install.ps1`. The site serves them at circuit.tako.id.
- Studio's readers include teammates who don't read TypeScript (NOC, support, managers). The Academy's readers are new to networking.
- The names are Circuit, Circuit Studio, and Circuit Academy.
- Tako is the only production user. Never invent testimonials, benchmarks, or adoption figures, and never imply Circuit does more than it does.
