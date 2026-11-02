---
name: release
description: Cut a Circuit release (stable or a release candidate) from v1. Use only when the owner explicitly asks to release, ship or publish a version.
---

# Release

Only the owner decides. Confirm the exact version before anything: a release publishes to npm at once and can't be taken back.

1. On `v1`, up to date, clean tree, `bun run check` passing.
2. Pick the version from what changed since the last tag (`git log $(git describe --tags --abbrev=0)..HEAD --oneline`). Tell the owner the version and why, and wait for the OK.
3. Bump `version` in `package.json` and `src/cli/version.ts`, commit `chore(release): vX.Y.Z`, push.
4. `gh release create vX.Y.Z --target v1 --generate-notes` (add `--prerelease` for `-rc.N`). Put `[critical]` in `--title` only when the owner says the fix is critical.
5. Watch it: `gh run list --limit 3`, `gh run watch <id>`. Report the result and the release link.

`DEPLOYMENT.md` has what the workflow does with each kind of release.
