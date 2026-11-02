---
description: One command installs Circuit like an app and starts your first project.
---

# Install

<img class="illustration" src="/illustrations/guide/install.webp" alt="A laptop with a terminal open, one line highlighted, leading to a new project folder with its files and a key." width="1536" height="1024">

Open a terminal in the folder where your project should go, and run:

<InstallTabs />

That's it. No Node, no npm, nothing else to install.

## What it does

1. Downloads `circuit` for your system and checks it against the release's checksums.
2. Installs it like an app:
    - **Windows:** `%LOCALAPPDATA%\Programs\Circuit\circuit.exe`. It's in **Settings > Apps**, with an uninstall.
    - **macOS and Linux:** `~/.local/bin/circuit`.
3. Adds it to your `PATH`, so `circuit` works from any folder.
4. Asks a few questions and writes your project.

Open a new terminal afterwards, and restart VS Code, so both find `circuit`.

## The questions

| Question                | Pick                                                                              |
| ----------------------- | --------------------------------------------------------------------------------- |
| Project folder          | Any name. `network` by default.                                                   |
| How to run Circuit      | **Simple** (recommended): just the app. **Full**: see [below](#full-install).     |
| Your AS number          | Yours, or keep `64500` for now and change it later in `circuit.ts`.               |
| Start a git repository? | Yes. Git keeps every change and who made it.                                      |
| Where to keep the key   | `.env.keys` (recommended) or 1Password. Only asked if you have the 1Password CLI. |
| Open in VS Code?        | Only asked if you have VS Code.                                                   |

Once you add a site and a device, the project looks like this:

<LayoutDiagram />

## Running it again

The same command is safe to run again. What it does depends on where you are:

| Where you run it                              | What happens                                                                                               |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Anywhere, with an older Circuit installed     | Updates Circuit.                                                                                           |
| In a project folder, like a fresh `git clone` | Sets that project up, no questions: editor types and the git hook. A full install also runs `bun install`. |
| In any other folder                           | Offers to start a new project there.                                                                       |

So a teammate who clones your project runs the install command once, in that folder, and is ready.

## Full install

A full install pins Circuit inside the project, in its `package.json`. The whole team then runs the same version.

- It needs [Bun](https://bun.sh). The installer offers to install it.
- The `circuit` app still works as usual. In a full-install project, it hands over to the project's own version.
- So two projects on two different versions never clash.

Node and npm come later.

## Your editor

Your editor completes every field and flags every wrong name as you type. It uses the project's `tsconfig.json` and `.circuit/types`. You don't install TypeScript: these editors bring their own.

| Editor                           | You install                                                 |
| -------------------------------- | ----------------------------------------------------------- |
| VS Code                          | Nothing. Tested with TypeScript 6.0.3 and 7.0.2.            |
| Cursor, Windsurf, VSCodium       | Nothing. Built on VS Code, not tested yet.                  |
| WebStorm, IntelliJ IDEA Ultimate | Nothing. TypeScript is built in, not tested yet.            |
| Zed                              | Nothing. Zed fetches its TypeScript server, not tested yet. |
| Neovim, Helix, Sublime Text      | Node and `typescript-language-server`, set up by hand.      |
| Notepad++ and plain editors      | No live checks. `circuit validate` still checks everything. |

We recommend VS Code.

## Updating

```sh
circuit update
```

Circuit checks for a new version before each command, at most once a minute, and tells you when there is one.

- **Stable versions** are on npm as `latest`, **release candidates** as `rc`.
- **A major version is your choice.** `circuit update` never moves you from 1.x to 2.x, or from 0.x to 1.x.
- **Critical fixes:** when a release fixes something critical, older versions stop. Only `circuit update` runs until you update.
- **Offline?** Circuit warns that it can't check, and carries on.

The editor types are rewritten the next time Circuit runs in a project.

## Uninstall

```sh
circuit uninstall
```

It asks first. Then it removes the app, its `PATH` entry, the **Settings > Apps** entry on Windows, and `~/.circuit`. Your projects are never touched.
