# Deployment

How a change gets from an idea to npm and circuit.tako.id.

## 1. A branch

A change to docs or repo meta files only (nothing in `src/`, `templates/`, `examples/`, `test/` or `package.json`) may go straight to `main`. The docs site publishes only with a stable release, so it reaches no one before then.

Everything else gets a branch from `main`, named after what it does:

```bash
git checkout main && git pull
git checkout -b feat/prometheus-auths     # or fix/..., docs/..., chore/...
```

Commits follow Conventional Commits with a scope from `commitlint.config.js`. The pre-commit hook runs the typecheck and the tests.

## 2. A pull request

```bash
bun run check                             # what CI runs
git push -u origin feat/prometheus-auths
gh pr create --base main
```

Say what changes, why, and what a reviewer should try. CI (`check.yml`) runs `bun run check` and must pass. Requests that belong together go in one pull request.

## 3. Review and merge

A maintainer reviews it. Once accepted:

```bash
gh pr merge --rebase --delete-branch
```

Merging releases nothing and doesn't touch the docs site. `main` can hold several merged changes before a release.

## 4. Release

When the maintainers decide `main` is ready:

```bash
git checkout main && git pull
bun run release minor            # or patch, major
```

The script bumps the version, commits, and pushes a tag. The tag runs `release.yml` (npm, GitHub Packages, the GitHub release); a stable tag also runs `pages.yml`, so circuit.tako.id always matches the version on npm.

A risky change goes out as a release candidate first, which npm keeps under the `rc` tag:

```bash
bun run release rc minor         # 0.14.0 to 0.15.0-rc.0
bun run release rc               # the next candidate
bun run release stable           # 0.15.0-rc.N to 0.15.0
```

Try a candidate on a real network before it goes stable: pin it in the network's `package.json` on a branch, and plan against its devices.

## 5. A network on the new release

Same path: a branch, a pull request that bumps `@takodotid/circuit`, CI, and a `diff` against its devices before anything is applied.
