---
name: prove-on-device
description: Prove what a real network device does before Circuit relies on it - try syntax without applying, read and plan against the device, apply and check it converges. Use when an adapter change depends on device behaviour, or when the owner asks to test on a device.
---

# Prove it on a device

Circuit never guesses what a device does. Prove it, then write what you learned in `src/platforms/<platform>/TRAPS.md`.

## Before

1. Get the owner's OK for this device, now. Say what you'll send and whether it changes anything.
2. Read the platform's `TRAPS.md`.
3. Secrets: `circuit secret set` in the scratch project. Never print one or write one into the repo.

## Try syntax without applying

- **RouterOS:** `:put [:parse "<command>"]` compiles without running. It misses text inside `rule=`, named actions and quoted values; check an enum with `/console inspect`.
- **VRP:** lines into the candidate (`system-view`), `display configuration candidate`, then `clear configuration candidate`.
- **Junos:** `configure exclusive`, `load set terminal`, `commit check`, `rollback 0`.
- **FortiOS:** prove under `cfg-save revert`, undo with `execute cfg reload`. Every `next` outside a transaction applies and saves.
- **Raisecom ROS:** applies at once. Spare port only.

Never send `?` or Tab on VRP or Raisecom.

## Against the device

Make a scratch project outside the repo with the one device file, then:

```bash
bun src/cli/index.ts diff <device> --project <scratch>        # what apply would send
bun src/cli/index.ts apply <device> --project <scratch>       # send it, after a yes
bun src/cli/index.ts diff <device> --project <scratch>        # must be empty now
bun src/cli/index.ts exec <device> '<show command>' --project <scratch>
```

Add `--console` to go through the serial console.

## Proved means

1. The plan shows exactly what you expect.
2. The apply succeeds and the next `diff` is empty. Not empty: the reader and the renderer disagree; fix that first.
3. Each surprise is one line in `TRAPS.md`: what happens, what Circuit does, device and version.
4. The device is left as found, or the owner is told what changed.
