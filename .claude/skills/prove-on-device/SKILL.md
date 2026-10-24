---
name: prove-on-device
description: Prove what a real network device does before Circuit relies on it - try new syntax without applying it, read and plan an example against the device, apply it and check it converges. Use whenever an adapter change depends on device behaviour, when implementing or fixing a platform, or when the owner asks to test on a device or in the lab.
---

# Prove it on a device

Circuit never guesses what a device does. Anything an adapter sends or reads is proved on a real device first, and what it taught goes into that platform's `TRAPS.md`.

## Before you touch a device

1. Get the owner's OK for this device, now. Say what you'll send and whether it changes anything. A lab device can still carry someone's access.
2. Read `src/platforms/<platform>/TRAPS.md`. Many surprises are already there.
3. Secrets come from the environment or a `.env` beside the device file. Never print one, never write one into a file in the repo.

## Try syntax without applying it

- **RouterOS:** `:put [:parse "<command>"]` compiles a command without running it and reports a syntax error or an unknown property. It doesn't check text inside `rule=`, whether a named action exists, or a quoted value (`check-gateway="bfd"` passed `:parse` and the run then refused it, restoring the backup and restarting the router). Check an enum with `/console inspect` first.
- **VRP:** send lines into the candidate (`system-view`), read `display configuration candidate`, then drop them with `clear configuration candidate`. `abort` isn't a command.
- **Junos:** `configure exclusive`, `load set terminal`, `commit check`, then `rollback 0` to drop the candidate.
- **FortiOS:** `execute config-transaction start` opens a transaction that `execute config-transaction abort` drops, but a transaction behaves differently from a plain apply. Prove the apply itself under `cfg-save revert`, then undo it with `execute cfg reload`. `abort` inside a table does nothing, and every `next` outside a transaction applies and saves.
- **Raisecom ROS:** applies at once. Use a spare port only.

Never send `?` or Tab to explore on VRP or Raisecom: a script's `?` runs the line.

## The lab script

`scripts/lab.ts` runs one device file against the device, without a project. It saves everything to `.lab/<device>/` (gitignored).

```bash
bun scripts/lab.ts examples/platforms/routeros.ts read                  # what it runs now
bun scripts/lab.ts examples/platforms/routeros.ts plan                  # what an apply would send
bun scripts/lab.ts examples/platforms/routeros.ts apply --confirm       # send it, read again, plan again
bun scripts/lab.ts examples/platforms/routeros.ts run -- ':put [:parse "/ip address add address=10.0.0.1/24 interface=ether1"]'
bun scripts/lab.ts examples/platforms/vrp.ts run --file=lines.txt --host-key=ssh-rsa
```

Add `--console` to go through `connection.console` instead of SSH. For a lab device, copy the example and point its `connection` at the lab, outside the repo or in `.lab/`.

## What proved means

1. The plan against the device shows exactly what you expect, nothing more.
2. `apply --confirm` succeeds, and the second plan it prints is empty (`converged`). A non-empty second plan means the reader and the renderer disagree: fix that before anything else.
3. Each surprise is one line in `TRAPS.md`: what happens and what Circuit does about it, with the device and version when it matters. Keep the file's style: plain, one behaviour per bullet.
4. Leave the device as you found it, or tell the owner what changed.
