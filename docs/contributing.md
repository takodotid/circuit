# Contributing

## Working on Circuit beside a network

Link the working copy into the network's project, so a change here is live there without a release:

```bash
cd circuit && bun link
cd ../my-network && bun link @takodotid/circuit
```

`bun install` in the network's project returns it to the release it pins.

## Checks

```bash
bun run typecheck
bun run test        # every example validates and plans nothing against its own render
bun run docs:dev    # this site, locally
```

## Adding a platform

1. `src/adapters/devices/<platform>/models.ts`: each model's ports per speed class and the platform's spelling of them.
2. An adapter implementing `DeviceAdapter` in `src/adapters/devices/types.ts`. `lines.ts` converges block-structured configurations; `routeros/` shows a command-structured one.
3. Register it in `src/adapters/devices/index.ts` and the catalog in `src/adapters/devices/catalog.ts`.
4. `unsupported()` lists every field it cannot express. Silence is not an option.
5. An example in `examples/` using every field it supports, and a `TRAPS.md` with what the platform taught.

New syntax is proved on a device without applying it: RouterOS compiles a command with `:put [:parse "..."]`, VRP discards a candidate with `clear configuration candidate`. A platform that applies at once is tried on a spare port.

## Releases

Circuit follows semantic versioning. Releases are cut from `main`:

```bash
bun run release patch            # 0.2.0 to 0.2.1
bun run release minor            # 0.2.1 to 0.3.0
bun run release rc minor         # 0.3.0 to 0.4.0-rc.0
bun run release rc               # 0.4.0-rc.0 to 0.4.0-rc.1
bun run release stable           # 0.4.0-rc.1 to 0.4.0
```

The script commits the version and pushes a tag. The tag publishes the package to GitHub Packages and a GitHub release with generated notes; a candidate is published under the `rc` dist-tag and marked as a prerelease.

Commits follow Conventional Commits with a scope from `commitlint.config.js`.
