# Getting started

## What you need

- [Bun](https://bun.sh), which runs Circuit. Circuit is written in TypeScript and needs no build step.
- A computer that can reach your devices' management addresses over SSH.
- An editor that understands TypeScript, such as VS Code. It shows what every field means as you type.

::: warning Alpha
Circuit runs a production network, but it is not stable yet: the way you write config, the commands and the supported devices can still change between releases. `circuit new` installs an exact version; read the [release notes](https://github.com/takodotid/circuit/releases) before you upgrade it.
:::

## Start a project

```bash
bunx @takodotid/circuit new
```

It asks a few questions:

1. **The directory** for the project, `my-network` by default.
2. **Which pattern is closest to your network.** A pattern is a ready-made layout with example devices:
    - [A single site](/patterns/single-site): a home, an office or an internal network, with a router and a switch.
    - [An edge router](/patterns/edge-router): your own AS number, with an IP transit and an internet exchange.
    - [Colocation with tenants](/patterns/colocation): you host customers who each get their own VLANs, addresses and ports.
3. **Your AS number**, for the patterns that use BGP.
4. **Whether your secrets are in 1Password.** See [1Password](/integrations/1password).

Then it creates the files and installs Circuit. The same answers can be given as options, which is handy in a script or for an AI agent:

```bash
bunx @takodotid/circuit new my-network --pattern edge-router --asn 64500 --1password
```

## What you get

Every project has these, whichever pattern you picked:

| File                | What it is                                                                                         |
| ------------------- | -------------------------------------------------------------------------------------------------- |
| `circuit.config.ts` | The list of your devices and your checks. Circuit starts here.                                     |
| one file per device | How that device should be configured                                                               |
| `checks.ts`         | Rules of your own that every change must pass. See [Checks](/guide/network#checks).                |
| `.env`              | Your devices' passwords and other secrets. Never committed. See [Secrets](/guide/secrets).         |
| `.circuit/`         | What Circuit writes, such as what each device ran when it was last read. Commit it; never edit it. |
| `AGENTS.md`         | Instructions for an AI agent working on the project. See [AI agents](/integrations/ai-agents).     |

The pattern's page explains each of its files.

## First run

The example devices have example addresses. Change them to your own first: the names, the management addresses, the ports and the VLANs. Then:

1. **Check that every secret can be read.**
    ```bash
    bun circuit secrets
    ```
2. **Check the files.** This catches typos, missing values and anything a device cannot do.
    ```bash
    bun circuit validate
    ```
3. **Read what each device runs now.** This logs in to each device and saves its configuration in `.circuit/state/`. Nothing is changed.
    ```bash
    bun circuit snapshot
    ```
4. **See what would change.**
    ```bash
    bun circuit diff
    ```
5. **Apply one device.** `apply` reads the device again and shows the plan. Read it. Only `--confirm` sends it.
    ```bash
    bun circuit apply router
    bun circuit apply router --confirm
    ```

::: danger The first plan is long
A device that was configured by hand runs many things your files do not describe yet. The first plan removes all of them, because the file is the whole truth. Read it line by line, and add to the file whatever must stay, until the plan only holds changes you want.
:::

## Adding Circuit to an existing project

If you would rather write the files yourself, install Circuit with an exact version:

```bash
bun add --exact @takodotid/circuit
```

and create `circuit.config.ts` as in [The network](/guide/network). The CLI then runs as `bun circuit`.
