# Contributing

## Working on Circuit beside a network

Link the working copy into the network's project, so a change here is live there without a release:

```bash
cd circuit && bun link
cd ../my-network && bun link @takodotid/circuit
```

The `circuit` command runs from `dist/`, so run `bun run build` in Circuit after a change. `bun install` in the network's project returns it to the release it pins.

## Checks

```bash
bun run typecheck
bun run test        # every example and template validates, and plans nothing against its own render
bun run build       # dist/, what Node, npm and pnpm run
bun run docs:dev    # this site, locally
```

## Templates

`templates/` holds what `circuit new` copies: one directory per pattern, and `project/` with what every project gets. The pattern pages on this site show those same files, so a change to a template is a change to its page. `bun run test` validates every template with its own checks.

## Writing the documentation

Write for someone who may be new to networking. Say what a thing does before how, explain a word the first time it matters or link the [Glossary](/guide/glossary), and break a process into numbered steps. A longer sentence that is easy to follow beats a short one that has to be read twice.

## Adding a platform

1. `src/adapters/devices/<platform>/models.ts`: each model's ports per speed class and the platform's spelling of them.
2. An adapter implementing `DeviceAdapter` in `src/adapters/devices/types.ts`. `lines.ts` converges block-structured configurations; `routeros/` shows a command-structured one.
3. Register it in `src/adapters/devices/index.ts` and the catalog in `src/adapters/devices/catalog.ts`.
4. `unsupported()` lists every field it cannot express. Silence is not an option.
5. An example in `examples/` using every field it supports, and a `TRAPS.md` with what the platform taught.

Another model of an existing platform only needs its ports in that platform's `models.ts`: how many of each speed, and how the platform spells them.

New syntax is proved on a device without applying it: RouterOS compiles a command with `:put [:parse "..."]`, VRP discards a candidate with `clear configuration candidate`. A platform that applies at once is tried on a spare port.

## Releases

Every change is a branch and a pull request; a release is cut from `main` only after the work in it is merged and accepted. [DEPLOYMENT.md](https://github.com/takodotid/circuit/blob/main/DEPLOYMENT.md) has the whole path. Circuit follows semantic versioning:

```bash
bun run release patch            # 0.2.0 to 0.2.1
bun run release minor            # 0.2.1 to 0.3.0
bun run release rc minor         # 0.3.0 to 0.4.0-rc.0
bun run release rc               # 0.4.0-rc.0 to 0.4.0-rc.1
bun run release stable           # 0.4.0-rc.1 to 0.4.0
```

The script commits the version and pushes a tag. The tag publishes the package to npm and GitHub Packages, and a GitHub release with generated notes; a candidate is published under the `rc` dist-tag and marked as a prerelease.

Commits follow Conventional Commits with a scope from `commitlint.config.js`.
