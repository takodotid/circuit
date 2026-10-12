# Circuit

Write how each router and switch should be configured, in one TypeScript file per device. Circuit shows you what would change, then makes the device match.

Documentation: [circuit.tako.id](https://circuit.tako.id)

> [!WARNING]
> Circuit is in alpha. It runs a production network, but the way you write config, the commands and the supported devices can still change between releases. Install an exact version, and read the release notes before you upgrade.

## What it does

- **One file per device.** VLANs, ports, addresses, routing, firewall, users and services, written in TypeScript. Your editor checks every name you refer to as you type.
- **The same words for every vendor.** MikroTik RouterOS 7, Huawei VRP and Raisecom ROS each get their own commands. What a device cannot do is an error before anything is sent.
- **The file is the whole truth.** A port, user or service the file does not mention is removed or turned off, so nothing set by hand lingers.
- **See every change first.** `diff` shows it offline, `apply` plans it against the live device, and nothing is sent without `--confirm`. On RouterOS, a change undoes itself if Circuit cannot log in again afterwards.
- **History in git.** Each device's last snapshot is kept in `.circuit/state/`, so the repository's history is the network's history.
- **Rules of your own.** Checks run on every change, and presets give ready-made filters, BGP policies and checks.
- **Secrets stay out of the repository.** They come from `.env` or 1Password, and never appear in a plan or a snapshot.
- **See the network.** Studio, started with `circuit studio`, draws the cables, VLANs, addresses, BGP sessions, OSPF neighbors and tunnels in your browser, and marks what is broken or differs from the device. Its tables list everything each device holds, for anyone who does not read TypeScript. `circuit graph` prints the drawing as Mermaid, DOT or JSON.
- **Keeps the rest in step.** Prefix lists fetched from a registry, your PeeringDB record, devices in LibreNMS, targets for Prometheus, WireGuard client configs, and your BGP communities for a looking glass.
- **Safe with AI agents.** Every project gets an `AGENTS.md` that tells an agent what it may run, and the last step stays yours.

<picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/public/screenshots/studio-dark.png">
    <img src="docs/public/screenshots/studio-light.png" alt="Studio's graph showing the cables between five devices. One device is outlined in amber because it differs from its last snapshot.">
</picture>

## Start

You need [Node.js](https://nodejs.org) 20.12 or newer, or [Bun](https://bun.sh). Then:

```bash
npx @takodotid/circuit new        # or: pnpm dlx @takodotid/circuit new, bunx @takodotid/circuit new
```

It asks which kind of network you have, creates a project with example devices, and installs Circuit. [Getting started](https://circuit.tako.id/guide/getting-started) walks through the first run.

Circuit supports MikroTik RouterOS 7, Huawei VRP and Raisecom ROS. Releases are on the [releases page](https://github.com/takodotid/circuit/releases), on npm and on GitHub Packages.

## Working on Circuit

```bash
bun install
bun run typecheck
bun run test        # every example and template validates, and plans nothing against its own render
bun run build       # dist/, what Node, npm and pnpm run
bun run docs:dev    # the documentation site, from docs/
```

[Contributing](https://circuit.tako.id/contributing) explains the layout, how to add a platform, and how releases are cut. `AGENTS.md` has the rules for changing the code.

## License

[Business Source License 1.1](LICENSE): free in production for an organization whose yearly revenue and funding, with its affiliates, are each under US$100,000. Above that, production use needs a commercial license from [legal@tako.id](mailto:legal@tako.id). Each version becomes Apache License 2.0 four years after it is published. See [License](https://circuit.tako.id/license).
