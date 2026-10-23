---
name: release
description: Cut a Circuit release (patch, minor, major or a release candidate) from main and publish it to npm, GitHub Packages and the docs site. Use only when the owner explicitly asks to release, ship or publish a version.
---

# Release

Only the owner decides to release. Never start one on your own, and confirm the exact version with the owner before you push a tag: a tag publishes to npm at once and can't be taken back.

1. Be on `main`, up to date, with a clean tree: `git checkout main && git pull && git status`.
2. Every change in it is merged through a pull request and accepted.
3. `bun run check` passes.
4. Pick the bump from what changed since the last tag (`git log $(git describe --tags --abbrev=0)..HEAD --oneline`): `fix` only is a patch, a `feat` is a minor, and a breaking change is at least a minor (Circuit is below 1.0.0). Tell the owner the version and why, and wait for the OK.
5. Run it:

    ```bash
    bun run release patch            # or minor, major
    bun run release rc minor         # a release candidate: 0.14.0 to 0.15.0-rc.0
    bun run release rc               # the next candidate
    bun run release stable           # 0.15.0-rc.N to 0.15.0
    ```

    It bumps `package.json`, commits `chore(release): vX.Y.Z` and pushes the tag. The tag runs `.github/workflows/release.yml` (npm, GitHub Packages, the GitHub release); a stable tag also runs `pages.yml` for circuit.tako.id.

6. Watch it: `gh run list --limit 3`, then `gh run watch <id>`. Report the result and the release link.

A risky change goes out as a release candidate first, and is tried on a real network before `stable`. `DEPLOYMENT.md` has the whole path.
