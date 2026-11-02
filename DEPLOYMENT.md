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
3. `.github/workflows/release.yml` runs: tests, the binaries and `SHA256SUMS` on the release, then npm.
    - Stable: npm dist-tag `latest`, and the docs site is rebuilt.
    - Candidate: npm dist-tag `rc`; the site stays as it is.
4. Something critical: put `[critical]` in the release title. The workflow deprecates the older versions of that major (needs the `NPM_TOKEN` secret, or run the printed `npm deprecate` by hand). Those versions then refuse to run until updated.

A major version never reaches anyone by itself: `circuit update` and `npm update` stay within the major they're on, as with Next.js.

Try a candidate on a real network before it goes stable: plan against its devices with `circuit diff`.
