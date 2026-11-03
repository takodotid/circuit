# Deployment

How a change gets from an idea to a release. Circuit v1 lives on the branch `v1`; `main` is still 0.x.

## 1. A branch

Branch from `v1`, named after what it does (`feat/...`, `fix/...`, `docs/...`, `chore/...`). Commits follow Conventional Commits with a scope from `commitlint.config.js`. The pre-commit hook runs the typecheck and the tests.

## 2. A pull request

```bash
bun run check                  # what CI runs
git push -u origin feat/thing
gh pr create --base v1
```

Say what changes, why, and what a reviewer should try. CI (`check.yml`) must pass.

## 3. Review and merge

A maintainer reviews it, then `gh pr merge --rebase --delete-branch`. Merging releases nothing.

## 4. Release

Only maintainers release, from GitHub:

1. Bump `version` in `package.json` and `src/cli/version.ts` on `v1`, commit `chore(release): vX.Y.Z`, push.
2. Create a GitHub release with the tag `vX.Y.Z` on `v1`. A candidate is `vX.Y.Z-rc.N`.
3. `.github/workflows/release.yml` runs: tests, the binaries, `SHA256SUMS` and its signature `SHA256SUMS.sig` on the release, then npm.
    - Stable: npm dist-tag `latest`, and the docs site is rebuilt.
    - Candidate: npm dist-tag `rc`; the site stays as it is.
    - Backport, a stable version older than npm's `latest` of the same major (`1.9.5` after `1.16.0`): npm dist-tag `latest-1.9`, the release is not marked Latest on GitHub, and the site stays as it is. Release it from a branch for its line.
4. Signing needs the repository secret `RELEASE_SIGNING_KEY`, the Ed25519 private key whose public key is in `src/cli/signing.ts`. Without it the workflow stops: Circuit installs nothing unsigned.
5. A security problem: release the fix on each line, then publish a GitHub security advisory naming the affected ranges and the fixed versions. See [SECURITY.md](SECURITY.md#how-a-fix-reaches-users).

A major version never reaches anyone by itself: `circuit update` and `npm update` stay within the major they're on, as with Next.js.

Try a candidate on a real network before it goes stable: plan against its devices with `circuit diff`.
