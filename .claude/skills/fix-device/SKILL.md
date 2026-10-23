---
name: fix-device
description: Fix a bug in a Circuit platform adapter that shows up on a real device - a plan that never empties, a refused command, a read that stops short, a field rendered wrong. Use when the owner reports device output, an error from snapshot, diff or apply, or a plan that keeps showing the same change.
---

# Fix a device bug

## 1. Get the facts

Ask the owner for what's missing:

- The platform, model and OS version.
- The exact command they ran and its full output: the plan, the error, or the lines the device printed.
- The device's own lines for the part that's wrong (from `.circuit/state/<device>`, or read it with `bun scripts/lab.ts <device.ts> read`).
- Whether the device is free to test on (skill `prove-on-device`).

## 2. Find the cause

- Read `src/platforms/<platform>/TRAPS.md` first.
- A plan that shows the same change after every apply: the reader and the renderer disagree on a form. Compare what `render()` writes with what the device prints for the same thing.
- A refused command: try the right form on the device without applying it (skill `prove-on-device`). Never guess the fix from the vendor's docs alone.

## 3. Fix it with a test

1. Write a failing test first, in `test/platforms/plans.test.ts`, from the device's real lines (with secrets and real names removed), or extend an example in `examples/` so `test/platforms/examples.test.ts` catches it.
2. Fix the adapter in `src/platforms/<platform>/`. Keep vendor syntax there.
3. `bun run typecheck`, `bun run test`.
4. Prove the fix on the device when one is free: plan, apply, and an empty second plan.
5. Add one line to `TRAPS.md` with what the device does and what Circuit now does about it, with the device and version.

## 4. Commit

On a branch: `fix(platforms): <what now works, in plain words>`, with a body saying what the device does and how Circuit handles it. Test, fix and `TRAPS.md` go in the same commit. Open a pull request. Never release on your own.
