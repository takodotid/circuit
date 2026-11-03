---
description: One command installs Circuit like an app. Then start a project, or set up one you cloned.
---

# Install

<img class="illustration" src="/illustrations/guide/install.webp" alt="A laptop with a terminal open, one line highlighted, leading to a new project folder with its files and a key." width="1536" height="1024">

Open a terminal and run:

<InstallTabs />

It installs `circuit` like an app and adds it to your `PATH`:

- **Windows:** `%LOCALAPPDATA%\Programs\Circuit\circuit.exe`, listed in **Settings > Apps**.
- **macOS and Linux:** `~/.local/bin/circuit`.

First it asks whether to install Circuit as an app. Say no for a [full install](#full-install).

Then it asks: **Set up a new project in this folder?** No is the default. You can always start one later with `circuit new`.

Open a new terminal afterwards, and restart VS Code, so both find `circuit`.

## Start a project

```sh
circuit new network
```

Or run `circuit` in an empty folder and pick **Start a new project**.

| Question                | Pick                                                                     |
| ----------------------- | ------------------------------------------------------------------------ |
| Project folder          | Any name. `network` by default.                                          |
| How to run Circuit      | **Simple** (recommended): the app. **Full**: see [below](#full-install). |
| Your AS number          | Yours, or keep `64500` for now and change it later in `circuit.ts`.      |
| Start a git repository? | Yes. Git keeps every change and who made it.                             |
| Open in VS Code?        | Only asked if you have VS Code.                                          |

Once you add a site and a device, the project looks like this:

<LayoutDiagram />

## Running the install command again

| Where you run it                              | What happens                                                    |
| --------------------------------------------- | --------------------------------------------------------------- |
| Anywhere, with Circuit installed              | Asks before updating the app. No is the default.                |
| In a project folder, like a fresh `git clone` | Sets that project up, no questions: editor types, the git hook. |
| In any other folder                           | Asks whether to set up a new project there.                     |

So a teammate who clones your project runs the install command once, in that folder, and is ready.

## Each project pins its version

A project keeps its Circuit version in `.circuit/VERSION`, committed with the rest:

```
1.0.0-rc.1
```

`circuit` runs that version, downloading it once into `~/.circuit/versions/`. So:

- Two projects on two versions never clash.
- Updating the app never changes a project.
- Everyone on the team runs the same version.

## Full install

Circuit as a package in the project, pinned in its `package.json`. Nothing goes on your `PATH`: you run it with Bun, as `bun circuit <command>`. Say no to "install as an app" in the installer, or pick **Full** in `circuit new`.

## Your editor

Your editor completes every field and flags every wrong name as you type, from the project's `tsconfig.json` and `.circuit/types`.

| Editor                           | You install                                                 |
| -------------------------------- | ----------------------------------------------------------- |
| VS Code                          | Nothing. Tested with TypeScript 6.0.3 and 7.0.2.            |
| Cursor, Windsurf, VSCodium       | Nothing. Built on VS Code, not tested yet.                  |
| WebStorm, IntelliJ IDEA Ultimate | Nothing. TypeScript is built in, not tested yet.            |
| Zed                              | Nothing. Zed fetches its TypeScript server, not tested yet. |
| Neovim, Helix, Sublime Text      | A TypeScript language server, set up by hand.               |
| Notepad++ and plain editors      | No live checks. `circuit validate` still checks everything. |

We recommend VS Code. A new project comes with `.editorconfig`, `.vscode/settings.json` and `.vscode/extensions.json`: VS Code asks to install the Prettier extension, and then formats each file as you save it. `circuit fmt` does the same from the terminal, for other editors and CI.

The style is in `.editorconfig`: 4 spaces, lines up to 140, LF. Both the Prettier extension and `circuit fmt` read it; everything else is Prettier's own defaults. A `.prettierrc.json`, if you add one, goes on top, for both.

## Updating

```sh
circuit update
```

- **In a project:** shows the newest version and asks before moving the project to it. No is the default. Then it rewrites `.circuit/VERSION` and the editor types.
- **Outside a project:** updates the app.
- **Never across a major version.** 1.x stays on 1.x. Moving to 2.x is your choice.

Circuit checks for a new version before each command, at most once a minute:

- **Newer one out:** a warning, and your command runs.
- **Critical fix out:** older versions stop. Only `circuit update` runs.
- **Offline:** a warning, and your command runs.

## Uninstall

```sh
circuit uninstall
```

It asks first. Then it removes the app, its `PATH` entry, the **Settings > Apps** entry on Windows, and `~/.circuit`. Your projects are never touched.
