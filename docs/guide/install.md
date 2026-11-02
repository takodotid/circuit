# Install

<img class="illustration" src="/illustrations/guide/install.webp" alt="A laptop with a terminal open, one line highlighted, leading to a new project folder with its files and a key." width="1536" height="1024">

One command installs Circuit and starts your first project. Run it in a terminal, in the folder where the project should go.

<InstallTabs />

The command downloads the `circuit` program for your system, checks it against the release's checksums, puts it in `~/.circuit/bin` (`%USERPROFILE%\.circuit\bin` on Windows), and adds that folder to your `PATH`. Then it asks a few questions and writes the project. Nothing else needs installing: no Node, no npm.

Open a new terminal afterwards, and restart VS Code, so both find `circuit`.

## What the installer asks

| Question                     | What to answer                                                                                                                                                                                                        |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Project folder               | A new folder's name, `network` by default.                                                                                                                                                                            |
| How the project runs Circuit | **Simple** (recommended): the `circuit` command alone. **Full**: Circuit as a package inside the project, its version pinned for the whole team, run with Bun. The installer offers to install Bun when it's missing. |
| Your network's AS number     | Your AS, or keep `64500`, a number for examples, and change it later in `circuit.ts`.                                                                                                                                 |
| Start a git repository?      | Yes, so every change is kept and can be reviewed. Asked only when git is installed.                                                                                                                                   |
| Where to keep the key        | The key that decrypts `.env`: in a `.env.keys` file (recommended), or in 1Password. Asked only when the 1Password CLI is installed. See [Secrets](/guide/secrets).                                                    |
| Open the project in VS Code? | Asked only when VS Code is installed.                                                                                                                                                                                 |

The installer writes `circuit.ts`, `sites/`, `tenants/`, `.env`, `.env.keys`, `.gitignore`, `tsconfig.json` and `.circuit/`. Once you add a site and a device, the project looks like this:

<LayoutDiagram />

To start another project later, run `circuit` in an empty folder and pick **Start a new project here**. If `circuit` isn't on your `PATH`, run the install command again in that folder.

## Your editor

The editor completes every field and marks every wrong name as you type. It does this with TypeScript, using the project's `tsconfig.json` and `.circuit/types`. You don't install TypeScript yourself: these editors bring their own.

| Editor                            | What to install                                                    |
| --------------------------------- | ------------------------------------------------------------------ |
| VS Code                           | Nothing. Checked with TypeScript 6.0.3 and 7.0.2.                  |
| Cursor, Windsurf, VSCodium        | Nothing: they are built on VS Code. Not checked yet.               |
| WebStorm, IntelliJ IDEA Ultimate  | Nothing: TypeScript is built in. Not checked yet.                  |
| Zed                               | Nothing: Zed downloads its TypeScript server. Not checked yet.     |
| Neovim, Helix, Sublime Text       | Node and `typescript-language-server`, set up by hand.             |
| Notepad++ and other plain editors | No checks as you type. `circuit validate` still checks everything. |

We recommend VS Code.

## Updating

Before each command, Circuit checks once a minute whether a newer version is out, and says so. Run:

```sh
circuit update
```

It downloads the new version, checks it, and puts it in place. In a project with a full install, it also pins the new version there. The editor's types are written again the next time Circuit runs in a project.

When a release fixes something critical, every older Circuit stops, and only `circuit update` runs. Without an internet connection, Circuit warns that it can't check, and goes on.
