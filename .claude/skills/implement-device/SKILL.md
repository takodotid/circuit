---
name: implement-device
description: Add support for a new device to Circuit, either a new operating system (a new platform adapter in src/platforms/) or a new hardware model of a platform Circuit already has. Use when the owner asks to support, add or implement a device, OS, vendor, model or platform.
---

# Implement a device

Two cases. Find out which one first.

- **A new model of a platform Circuit has** (say another MikroTik on RouterOS 7): only its ports change. Go to "New model".
- **A new operating system, or a version too different to share an adapter** (say RouterOS 6): a new platform. Go to "New platform".

## Ask the owner first

Don't start until you know all of these. Ask for what's missing, in one message:

1. Vendor, OS name, exact OS version, and hardware model.
2. Its ports: how many of each speed, and how the OS spells them (`sfp-sfpplus1`, `xe-0/0/0`, `port1`). Does it count from 0 or 1? Do higher speeds continue the count after lower ones?
3. How Circuit reaches it in the lab: SSH address and user, or a serial console (COM port on this computer, or a `/dev` path on a jump host), and its baud rate.
4. Is the device free to break? Is there a spare port? Can it be reset to factory?
5. Which features they need first. A new platform starts with what the owner needs, and everything else goes in `unsupported()`.

## New model

1. Add the model to `src/platforms/<platform>/models.ts`: ports per speed class and the platform's spelling. A spelling can shift the number: `{n-1}` counts from 0, `{n+47}` continues after 47 ports. Copy the shape of the model already there.
2. Run `bun run typecheck`: a device file using the new model and a port name it doesn't have must fail to compile.
3. Read the device's ports on the real device and compare with the spelling (skill `prove-on-device`).
4. Add the model to the "Proved on" column in `docs/platforms/index.md` once proved.

## New platform

Read these first, they are the contract and the closest working code:

- `src/platforms/platform.ts`: the `Platform` base class every adapter extends.
- The adapter closest to the new OS: `routeros/` is written as commands, `junos/` as `set` statements, `vrp/` and `raisecom-ros/` as indented blocks planned with `LineDiff` (`src/platforms/line-diff.ts`), `fortios/` as nested `config`/`edit` blocks.
- That adapter's `TRAPS.md`, and `docs/guide/convergence.md` for how each platform applies safely.

Then build it in this order. Each step ends with `bun run typecheck` and `bun run test` passing.

1. **Catalog.** `src/platforms/<name>/models.ts` with the model. Add it to `Catalog.MODELS` in `src/platforms/catalog.ts`.
2. **Class.** `src/platforms/<name>/index.ts` exports `class <Name> extends Platform` with `name`, `os` (name, the versions it renders for, what it was proved on, whether a read checks the version), `extension` for snapshots, and `static readonly CONSOLE` when it has a serial console. Register it in `src/platforms/index.ts`. Other files in the folder are classes named `<Name><Job>` (`<Name>Render`, `<Name>Plan`).
3. **`unsupported()` first.** List every schema field (`src/schema/`) the platform can't express yet. Start wide, then shrink it as features land. Never let a field render to nothing.
4. **`render()`.** The whole config the device should run, in the device's own form, with secrets as markers from `Secrets.marker()`. Render exactly what the device prints back where you can, so a read and a render compare equal.
5. **`read()`.** Log in (`Ssh` or `SerialConsole`), check the version against `os.versions` when the output is proved, read the config, remove secrets and lines the device adds by itself, and return it in the form `render()` produces.
6. **`plan()`.** The steps from `current` to `desired`: what a reviewer reads (`show`) and what is sent (`send`). Anything it can't converge goes in `problems`.
7. **`apply()`.** Send the plan so a mistake can't lock everyone out: a candidate with commit confirmed, a revert timer, or a backup that restores itself. Then prove access with a fresh login before making it stick. Copy the guard of the closest adapter.
8. **`fill()`**, only if the OS can hold prefix sets filled from a registry.
9. **Example.** A device file in `examples/` using every field the platform supports. Add it to `test/platforms/examples.test.ts` and to `examples/golden.config.ts`. It must validate and plan nothing against its own render.
10. **Plan tests** in `test/platforms/plans.test.ts` for each change the plan orders in a special way.
    A session test reads (and, where it can, applies) through `test/platforms/fake-ssh.ts`, a fake device over SSH, like `routeros-session.test.ts` and `junos-session.test.ts`: the login, the version check and the read run in every test run, not only in the lab.
11. **Prove it on the device** (skill `prove-on-device`): read, plan, apply the example, read again, and plan again. The second plan must be empty. Write each surprise into `src/platforms/<name>/TRAPS.md`, one line each: what happens, and on which device and version.
12. **Docs.** `docs/platforms/<name>.md` (copy another platform's page, it includes `TRAPS.md`), a row in both tables of `docs/platforms/index.md`, the sidebar in `docs/.vitepress/config.ts`, how it applies in `docs/guide/convergence.md`, the platform list in `README.md`, `docs/guide/introduction.md` and `PRODUCT.md`, and a keyword in `package.json`.

## Version rule

A platform is one OS at the versions in its `os.versions`, not every version of it. A new version of an OS Circuit already has is either a wider `os.versions` once proved on that version, or, when it takes different commands, a new platform.

## Commit

On a branch, as `feat(platforms): <OS> on the <model>, applied with <how it rolls back>`, with a body that says what it covers and what it was proved on. Open a pull request (`DEPLOYMENT.md`). Never release on your own.
