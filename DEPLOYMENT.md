# Deployment

How a change gets from an idea to a release on npm and to circuit.tako.id.

## 1. A branch for every change

Never commit to `main`. Start a branch from it, named after what it does:

```bash
git checkout main && git pull
git checkout -b feat/prometheus-auths     # or fix/..., docs/..., chore/...
```

Commit as often as you like, with a message after Conventional Commits and a scope from `commitlint.config.js`. The pre-commit hook runs the typecheck and the tests.

## 2. A pull request

Push the branch and open a pull request to `main`:

```bash
git push -u origin feat/prometheus-auths
gh pr create --base main
```

Say what changes, why, and anything a reviewer should try. CI, `check.yml`, must pass: the typecheck, the tests, formatting, the documentation build, and every template validated by the Node build.

Keep working on the same branch until the pull request is ready. Several requests that belong together go in one pull request.

## 3. Review and merge

A maintainer reviews it. When it is accepted, merge it into `main` with a rebase, and delete the branch:

```bash
gh pr merge --rebase --delete-branch
```

Merging does not release anything, and does not change the documentation site. `main` can hold several merged changes before the next release.

## 4. Release

When the maintainers decide `main` is ready to ship, cut a release from it:

```bash
git checkout main && git pull
bun run release minor            # or patch, major
```

The script bumps the version, commits it, and pushes a tag. The tag starts `release.yml`, which publishes the package to npm and GitHub Packages and creates the GitHub release. A stable tag also starts `pages.yml`, which publishes the documentation, so circuit.tako.id always describes the version on npm.

A risky change goes out as a release candidate first, which npm keeps under the `rc` tag, away from anyone who installs the latest version:

```bash
bun run release rc minor         # 0.14.0 to 0.15.0-rc.0
bun run release rc               # the next candidate
bun run release stable           # 0.15.0-rc.N to 0.15.0
```

Try a candidate on a real network before it goes stable: pin it in the network's `package.json` on a branch there, and plan against its devices.

## 5. A network on the new release

A network moves to a new release the same way: a branch, a pull request that bumps `@takodotid/circuit`, CI, and a `diff` against its devices, before anything is applied.
