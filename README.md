# Circuit

Circuit turns one TypeScript file per network device into that device's config, shows what would change, then makes the device match.

> [!WARNING]
> Circuit v1 is not released yet. It is a rewrite of the config language, and every version is a release candidate, `1.0.0-rc.N`, until it is stable. The language, the model and the commands can still change between candidates. Circuit 0.x, the version in use today, is on the `main` branch.

## What it does

- **One file per device.** Ports, VLANs, addresses, routing, BGP, firewall, users and services, written as plain data. Your editor checks every name and every port as you type.
- **Plain TypeScript, nothing to install.** A project imports nothing from Circuit and needs no npm and no Node. Circuit's functions are globals, and the editor reads its types from `.circuit/types`, which `circuit init` writes.
- **One binary.** `circuit` has Bun inside. It reads the project, checks what the editor can't, and talks to the devices.
- **Same words for every vendor.** MikroTik RouterOS 7, Huawei VRP, Raisecom ROS, Juniper Junos and Fortinet FortiOS each get their own commands. Anything a device can't do is an error before anything is sent.
- **The file is the whole truth.** A port, user or service the file doesn't write is removed or turned off. Circuit fills in nothing you didn't write.
- **See every change first.** `diff` shows it offline, `apply` plans it against the live device, and nothing is sent without `--confirm`.
- **Secrets stay out of the repo.** They come from `.env` or 1Password and never show up in a plan or a snapshot.

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

In the editor, `"10g-49"` is an error, `10g-49 is not a port of CE6855-48S6Q-HI`, and so is `trunk_vlans: ["mgnt"]`: the device has no VLAN of that name. `circuit check` says the same, with the file and line, and `Did you mean mgmt?`. [How to write a project](docs/project.md) has the whole project: this switch in full, a router and a tenant.

## Start

1. Build the binary (below), or take one from a release once there is one.
2. Start a project: `circuit init my-network --asn 64500`. It writes `circuit.ts`, `sites/`, `tenants/`, `tsconfig.json`, `.gitignore`, `.env`, and the editor's types in `.circuit/types`.
3. Open the folder in VS Code. Write each device in `sites/<site>/<device>.ts`.
4. Run `circuit check`. It reads the project and runs every check.
5. Run `circuit diff` to see what would change, then `circuit apply <device> --confirm`.

After Circuit is updated, run `circuit init` again in the project: it writes the editor's types again and changes nothing else.

## Commands

Every command but `init` reads the project in the working directory, or in the folder `--project <folder>` names.

| Command                                 | What it does                                                                          |
| --------------------------------------- | ------------------------------------------------------------------------------------- |
| `init [folder]`                         | Starts a project, or writes the editor's types again. `--asn` for a new project's AS. |
| `check`                                 | Reads the project and checks it, then runs every check in `circuit.ts`.               |
| `build <device>`                        | Prints the config the device should run, without contacting it.                       |
| `diff [device...]`                      | What `apply` would send, planned against the last snapshot, offline.                  |
| `snapshot [device...]`                  | Reads what each device runs into `.circuit/state`.                                    |
| `apply <device>`                        | Reads the device, plans against what it runs, and sends with `--confirm`.             |
| `show <device> [command...]`            | Runs commands that only read and prints the answer, secrets hidden.                   |
| `bgp [device]`                          | Each BGP neighbor next to its live session: up or down, prefixes, uptime.             |
| `console <device>`                      | Opens the device's serial console, logged in, or sends it lines.                      |
| `refresh <device>`                      | Fetches prefix sets that come from a registry onto the device, with `--confirm`.      |
| `wireguard <device> <interface> <peer>` | Prints a client config for one WireGuard peer.                                        |
| `communities`                           | Prints the network's BGP communities, for a looking glass or bgp.tools.               |
| `secrets`                               | Lists every secret the project uses, and whether each can be read.                    |

`.circuit/state` holds what each device ran when Circuit last read it, secrets removed. Commit it, so the history of the project is the history of the network.

## Docs

- [How to write a project](docs/project.md): layout, globals, rules, parts, merge, communities, checks.
- [The model](docs/model.md): what one device holds, and what Circuit resolves before a platform reads it.
- [Decisions](docs/decisions.md): what shaped v1, and why.
- `src/config/`: every field, with its doc comment, which your editor shows on hover.
- `src/platforms/<platform>/TRAPS.md`: what each device does that you wouldn't expect.

## Working on Circuit

```bash
bun install
bun run check       # typecheck, tests, and the binary
bun run build       # dist/circuit, or dist/circuit.exe on Windows
bun src/cli/index.ts check --project <folder>   # run Circuit from the sources
```

`AGENTS.md` has the rules for changing the code, for people and AI agents alike.

## License

[Business Source License 1.1](LICENSE): free in production for an organization whose yearly revenue and funding, with its affiliates, are each under US$100,000. Above that, production use needs a commercial license from [legal@tako.id](mailto:legal@tako.id). Each version becomes Apache License 2.0 four years after it is published.
