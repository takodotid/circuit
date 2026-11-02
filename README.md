# Circuit

Circuit turns one TypeScript file per network device into that device's config, shows what would change, then makes the device match.

> [!WARNING]
> Circuit v1 is not released yet. It is a rewrite of the config language, and every version is a release candidate, `1.0.0-rc.N`, until it is stable. The language, the model and the commands can still change between candidates. Circuit 0.x, the version in use today, is on the `main` branch.

## What it does

- **One file per device.** Ports, VLANs, addresses, routing, BGP, firewall, users and services, written as plain data. Your editor checks every name and every port as you type.
- **Plain TypeScript, nothing to install.** A project imports nothing from Circuit and needs no npm and no Node. Circuit's functions are globals, and the editor reads its types from `.circuit/types`, which Circuit writes.
- **One binary.** `circuit` has Bun inside. It reads the project, checks what the editor can't, and talks to the devices.
- **Same words for every vendor.** MikroTik RouterOS 7, Huawei VRP, Raisecom ROS, Juniper Junos and Fortinet FortiOS each get their own commands. Anything a device can't do is an error before anything is sent.
- **The file is the whole truth.** A port, user or service the file doesn't write is removed or turned off. Circuit fills in nothing you didn't write.
- **See every change first.** `diff` and `apply` read the live device and show what would change; `apply` sends it only once you say yes.
- **Secrets are encrypted.** Each value in `.env` is encrypted, so `.env` is committed; the key stays out of git, in `.env.keys` or 1Password. A git hook stops a commit with a secret in plain text.

## A device

```ts
// sites/site-a/switch-01.ts
import { as64500 } from "../../circuit";
import { site_a } from "./site";

export default as64500.device({
    name: "switch-01",
    site: "site-a",
    platform: "vrp",
    model: "CE6855-48S6Q-HI",
    connection: { host: "192.0.2.2", user: "netops" },
    system: {
        users: { netops: { role: "admin", password: secret("SWITCH_01_ADMIN_PASSWORD") } },
    },
    interfaces: {
        ethernet: {
            "10g-1": { description: "edge-01 sfp28-2", trunk_vlans: ["mgmt"], link: { device: "edge-01", port: "25g-2" } },
        },
        vlan_interface: {
            mgmt: { vlan: "mgmt", addresses: [site_a.addresses.switch] },
        },
    },
    switching: {
        vlans: { mgmt: site_a.vlans.mgmt },
    },
});
```

In the editor, `"10g-49"` is an error, `10g-49 is not a port of CE6855-48S6Q-HI`, and so is `trunk_vlans: ["mgnt"]`: the device has no VLAN of that name. `circuit validate` says the same, with the file and line, and `Did you mean mgmt?`. [How to write a project](docs/guide/project.md) has the whole project: this switch in full, a router and a tenant.

## Start

1. Install Circuit, which then starts a project:
    - Linux and macOS: `curl -fsSL https://circuit.tako.id/install | sh`
    - Windows, in PowerShell: `irm https://circuit.tako.id/install.ps1 | iex`
2. Open the project's folder in VS Code. Add a site in `circuit.ts`, then write each device in `sites/<site>/<device>.ts`.
3. Run `circuit`. It opens a menu, or runs a command straight away, such as `circuit validate`.

Circuit checks for a newer version before each command and warns when there is one: run `circuit update`.

## Commands

Each reads the project in the working directory or the nearest folder above it, or in the folder `--project <folder>` names. Leave out the device and Circuit lists them to pick from.

| Command                             | What it does                                                                              |
| ----------------------------------- | ----------------------------------------------------------------------------------------- |
| `validate`                          | Reads the project and checks it, then runs every check in `circuit.ts`.                   |
| `diff [device]`                     | Reads the device and shows what `apply` would change.                                     |
| `apply [device]`                    | Reads the device, shows what would change, and sends it once you say yes (`--confirm`).   |
| `exec [device] [command...]`        | Runs commands that only read on the device, and prints the answer, secrets hidden.        |
| `bgp [device]`                      | Each BGP neighbor next to its live session: up or down, prefixes, uptime.                 |
| `access-console [device] [line...]` | Opens the device's serial console, logged in, or sends it lines.                          |
| `studio`                            | Opens the project in your browser: the graph, every table, tools, compare and secrets.    |
| `rename [device] [new-name]`        | Gives a device a new name everywhere the project writes it, and its file too.             |
| `env`                               | Lists the secrets in `.env`; `env set`, `get`, `delete`, `encrypt` and `rotate` the rest. |
| `update`                            | Installs the newest Circuit.                                                              |

## Docs

- [The documentation site](https://circuit.tako.id), whose pages are in `docs/`: install, writing a project, the `circuit` command, secrets, Studio, and Circuit Academy.
- [How to write a project](docs/guide/project.md), then [rules](docs/guide/rules.md), [parts and merge](docs/guide/parts.md), [communities](docs/guide/communities.md) and [checks](docs/guide/checks.md).
- [The model](docs/reference/model.md): what one device holds, and what Circuit resolves before a platform reads it.
- [Decisions](docs/reference/decisions.md): what shaped v1, and why.
- `src/config/`: every field, with its doc comment, which your editor shows on hover.

## Working on Circuit

```bash
bun install
bun run check       # typecheck, tests, and the binary
bun run build       # dist/circuit, or dist/circuit.exe on Windows
bun src/cli/index.ts validate --project <folder>   # run Circuit from the sources
```

`AGENTS.md` has the rules for changing the code, for people and AI agents alike.

## License

[Business Source License 1.1](LICENSE): free in production for an organization whose yearly revenue and funding, with its affiliates, are each under US$100,000. Above that, production use needs a commercial license from [legal@tako.id](mailto:legal@tako.id). Each version becomes Apache License 2.0 four years after it is published.
