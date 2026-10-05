# Circuit

Write how each router and switch should be configured, in one TypeScript file per device. Circuit shows you what would change, then makes the device match.

Documentation: [circuit.tako.id](https://circuit.tako.id)

> [!WARNING]
> Circuit is in alpha. It runs a production network, but the way you write config, the commands and the supported devices can still change between releases. Install an exact version, and read the release notes before you upgrade.

## Start

You need [Bun](https://bun.sh). Then:

```bash
bunx @takodotid/circuit new
```

It asks which kind of network you have, creates a project with example devices, and installs Circuit. [Getting started](https://circuit.tako.id/guide/getting-started) walks through the first run.

Circuit supports MikroTik RouterOS 7, Huawei VRP and Raisecom ROS. Releases are on the [releases page](https://github.com/takodotid/circuit/releases), on npm and on GitHub Packages.

## Working on Circuit

```bash
bun install
bun run typecheck
bun run test        # every example and template validates, and plans nothing against its own render
bun run docs:dev    # the documentation site, from docs/
```

[Contributing](https://circuit.tako.id/contributing) explains the layout, how to add a platform, and how releases are cut. `AGENTS.md` has the rules for changing the code.

## License

[Business Source License 1.1](LICENSE): free in production for an organization whose yearly revenue and funding, with its affiliates, are each under US$100,000. Above that, production use needs a commercial license from [legal@tako.id](mailto:legal@tako.id). Each version becomes Apache License 2.0 four years after it is published. See [License](https://circuit.tako.id/license).
