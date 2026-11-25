---
description: One command installs Circuit like an app. Then start a project, or set up one you cloned.
---

# Install

<img class="illustration" src="/illustrations/guide/install.webp" alt="A laptop with a terminal open, one line highlighted, leading to a new project folder with its files and a key." width="1536" height="1024">

Open a terminal and run the command for your system.

<InstallTabs />

The command installs `circuit` like an app and adds it to your `PATH`.

- On Windows, it goes in `%LOCALAPPDATA%\Programs\Circuit\circuit.exe`, and **Settings > Apps** lists it.
- On macOS and Linux, it goes in `~/.local/bin/circuit`.

On a first install, it asks whether to install Circuit as an app. Say no for a [full install](#full-install). Then it asks whether to set up a new project in this folder. No is the default, and you can start one later with `circuit new`.

Afterwards, open a new terminal and restart VS Code, so both find `circuit`.

To check each download's signature, the command needs `ssh-keygen` from OpenSSH. On a minimal Linux, such as a container image, install `openssh-client` first. For CI, see [Run in CI](/guide/ci).

## With Homebrew

On macOS and Linux, [Homebrew](https://brew.sh) installs Circuit from Tako's tap:

```sh
brew install takodotid/tap/circuit
```

Homebrew then owns the `circuit` it installed. Update it with `brew upgrade takodotid/tap/circuit`, and remove it with `brew uninstall takodotid/tap/circuit`. Circuit doesn't update or remove itself there, and tells you the Homebrew command instead. Start a project with `circuit new`, as below.

## Start a project

```sh
circuit new network
```

Or run `circuit` in an empty folder and pick **Start a new project**. Circuit asks a few questions.

| Question                     | Answer                                                                              |
| ---------------------------- | ----------------------------------------------------------------------------------- |
| Project folder               | Any name.                                                                           |
| How to run Circuit           | **Simple** (recommended) runs the app. **Full** is a [full install](#full-install). |
| Your network's AS number     | Yours. Or keep `64500`, and change it later in `circuit.ts`.                        |
| Start a git repository?      | Yes.                                                                                |
| Open the project in VS Code? | Circuit asks only if you have VS Code.                                              |

[Your first project](/guide/project) shows the project's layout.

## Run the install command again

| Where you run it                           | What happens                                                       |
| ------------------------------------------ | ------------------------------------------------------------------ |
| Anywhere, with Circuit installed           | It asks before it updates Circuit. No is the default.              |
| In a project folder, such as a fresh clone | It sets up that project without questions: editor types, git hook. |
| In any other folder                        | It asks whether to set up a new project there.                     |

A teammate who clones your project runs the install command once, in that folder.

## Each project pins its version

A project keeps its Circuit version, such as `1.0.0`, in `.circuit/version`. You commit that file, and every command in the project runs that version.

The first time, Circuit asks before it downloads the version. It keeps each version once, in `~/.circuit/versions/`, and removes it when no project uses it any more.

## Full install

A full install keeps Circuit inside one project, as a package pinned in its `package.json`. Nothing goes on your `PATH`. You run Circuit with Bun, as `bun circuit <command>`.

To get one, say no to "Install Circuit as an app?" in the installer, or pick **Full** in `circuit new`. If Bun is missing, Circuit offers to install it.

## Your editor

Your editor completes every field and marks every wrong name as you type, with the types in `.circuit/types`.

| Editor                           | You install                                                 |
| -------------------------------- | ----------------------------------------------------------- |
| VS Code                          | Nothing. Tested with TypeScript 6.0.3 and 7.0.2.            |
| Cursor, Windsurf, VSCodium       | Nothing. Built on VS Code, not tested yet.                  |
| WebStorm, IntelliJ IDEA Ultimate | Nothing. TypeScript is built in, not tested yet.            |
| Zed                              | Nothing. Zed fetches its TypeScript server, not tested yet. |
| Neovim, Helix, Sublime Text      | A TypeScript language server, set up by hand.               |
| Notepad++ and plain editors      | No live checks. `circuit validate` still checks everything. |

VS Code is the recommended editor. In a new project, VS Code offers the Prettier extension, which tidies each file when you save. In other editors, run [`circuit fmt`](/reference/cli#fmt).

## Updating

```sh
circuit update
```

In a project, Circuit lists up to five newer versions, newest first. Pick one, then commit `.circuit/version` so your team gets it too. A project never moves to a new major version by itself, so 1.x stays on 1.x.

Circuit also updates itself before each command, so you rarely need `circuit update --app`. Your projects keep their own versions.

A Circuit that a package manager installed never replaces itself. It tells you a newer version is out, and the package manager's command to get it.

If a [security advisory](https://github.com/takodotid/circuit/security/advisories) affects your project's version, Circuit runs nothing until you move the project to a fixed version. [SECURITY.md](https://github.com/takodotid/circuit/blob/main/SECURITY.md) explains advisories and signed releases.

## Uninstall

```sh
circuit uninstall
```

It asks first. Then it removes Circuit, its `PATH` entry, the **Settings > Apps** entry on Windows, and `~/.circuit`. It never touches your projects.

If a package manager installed Circuit, `circuit uninstall` removes nothing and gives you the package manager's command.
