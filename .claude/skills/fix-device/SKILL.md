---
name: fix-device
description: Fix a bug in a Circuit platform adapter seen on a real device - a plan that never empties, a refused command, a read that stops short, a field rendered wrong. Use when the owner reports device output, an error from diff or apply, or a plan that keeps showing the same change.
---

# Fix a device bug

## 1. Facts

Ask for what's missing:

- The platform, model, and OS version.
- The exact command and its full output.
- The device's own lines for the wrong part: `circuit exec <device> '<show command>'`.
- Whether the device is free to test on.

## 2. Cause

- Read `src/platforms/<platform>/TRAPS.md`.
- The same change after every apply: reader and renderer disagree on a form. Compare `render()` with what the device prints.
- A refused command: try the right form without applying (skill `prove-on-device`). Never guess from vendor docs alone.

## 3. Fix with a test

1. A failing test first, from the device's real lines (secrets and real addresses removed): `test/platforms/plans.test.ts` or the platform's `*-proofs.test.ts`.
2. Fix in `src/platforms/<platform>/`. Vendor syntax stays there.
3. `bun run check`. The golden tests must still pass.
4. Test on the device when it is free: plan, apply, empty second plan.
5. One line in `TRAPS.md`.

## 4. Commit

On a branch from `main`: `fix(platforms): <what you fixed>`, with the test, the fix, and `TRAPS.md` in one commit. Open a pull request. Never release on your own.
