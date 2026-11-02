---
name: implement-device
description: Add a device to Circuit - a new operating system (a platform adapter in src/platforms/) or a new hardware model of a platform Circuit has. Use when the owner asks to support, add or implement a device, OS, vendor, model or platform.
---

# Implement a device

Two cases; find out which first.

- **A new model of a platform Circuit has:** only its ports change. See "New model".
- **A new OS, or a version that takes other commands:** a new platform. See "New platform".

## Ask first, in one message

1. Vendor, OS, exact version, hardware model.
2. Ports: how many of each speed, how the OS spells them, from 0 or 1.
3. How Circuit reaches it in the lab: SSH address and user, or serial console and baud rate.
4. Is it free to break? A spare port? Can it be reset?
5. Which features they need first. Everything else goes in `unsupported()`.

## New model

1. Add it to `src/platforms/<platform>/models.ts` (copy a model's shape). A limit below the datasheet goes in `limits`, only once a real device hit it.
2. `bun run typecheck`: a device using a port the model doesn't have must fail in the editor.
3. Read the ports on the device (skill `prove-on-device`).

## New platform

Read `src/platforms/platform.ts` (the contract) and the closest adapter: `routeros/` (commands), `junos/` (`set` lines), `vrp/` and `raisecom-ros/` (indented blocks, `LineDiff`), `fortios/` (`config`/`edit` blocks). Then, with `bun run check` passing after each step:

1. `models.ts`, added to `Catalog.MODELS`.
2. `index.ts`: `class <Name> extends Platform` (`name`, `os`, `extension`, `console` if it has one), registered in `src/platforms/index.ts`. Other classes are `<Name><Job>`.
3. `unsupported()` first: every model field it can't express. Never render a field to nothing.
4. `render()`: the whole config, secrets as `Secrets.marker()`, in the form the device prints back.
5. `read()`: log in, check the version, read, strip secrets and device-added lines.
6. `plan()`: `show` for the reviewer, `send` for the device, `problems` for what can't converge.
7. `apply()`: a change that can't lock anyone out (commit confirmed, revert timer, or self-restoring backup), then a fresh login before it sticks.
8. Tests: plans in `test/platforms/plans.test.ts`; a session test over `test/platforms/fake-ssh.ts`.
9. Prove it on the device: read, plan, apply, empty second plan. Surprises go in `TRAPS.md`.
10. Docs: the platforms page and the feature matrix in `docs/`, `README.md`, `PRODUCT.md`, a `package.json` keyword.

A platform is one OS at the versions in `os.versions`. A new version widens it once proved, or is a new platform if its commands differ.

## Commit

On a branch from `v1`: `feat(platforms): <OS> on the <model>, applied with <how it rolls back>`. Open a pull request. Never release on your own.
