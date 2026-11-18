# Contributing

How to change Circuit's code, from a branch to a release. To report a bug, ask a question, or fix the docs, see [Contributing](https://circuit.tako.id/contributing) on the website.

- [AGENTS.md](AGENTS.md) has the rules for code and writing. They apply to people and AI agents alike.
- Everyone follows the [Code of Conduct](CODE_OF_CONDUCT.md).
- Report a vulnerability privately, as [SECURITY.md](SECURITY.md) says.

## Set up

Install [Bun](https://bun.sh), then:

```bash
bun install        # dependencies, Studio's page, the editor types, Vale's style and the git hooks
bun run docs:dev   # the website, locally
```

To run Circuit from the sources on a project:

```bash
cd <project> && bun <repo>/src/cli/index.ts <command>
```

## Checks

| Command          | What it runs                                                                           |
| ---------------- | -------------------------------------------------------------------------------------- |
| `bun run check`  | Studio's build, the typecheck, the tests, the format, and the binary, as CI runs them. |
| `bun run lint`   | Oxlint for code, Vale for writing, and knip for unused code.                           |
| `bun run format` | Prettier, on every file.                                                               |

`bun run check` must pass before every commit. The git hooks run the typecheck and the tests, and check the commit message.

## Commits

- Use [Conventional Commits](https://www.conventionalcommits.org) in the imperative mood, lowercase: `fix(cli): keep remembered secrets for 24 hours`.
- The scopes are in `commitlint.config.js`, with the part of the repo each one covers.
- Each commit does one thing, holds its tests and docs, and passes the checks on its own.

## Branches and pull requests

Circuit lives on `main`. Branch from it, and name the branch after what it does: `feat/...`, `fix/...`, `docs/...`, or `chore/...`.

```bash
bun run check
git push -u origin feat/thing
gh pr create --base main
```

In the pull request, say what changes, why, and what a reviewer should try. CI must pass. A maintainer reviews it and merges it with `gh pr merge --rebase --delete-branch`. Merging releases nothing.

## Releases

Only maintainers release. AI agents use the skill `release`.

1. On `main`, change `version` in `package.json` and `src/cli/version.ts`. Commit it as `chore(release): vX.Y.Z` and push.
2. Create a GitHub release from `main` with the tag `vX.Y.Z`. A release candidate is `vX.Y.Z-rc.N`, marked as a pre-release. A backport is released from a branch for its line.
3. The workflow `.github/workflows/release.yml` runs the typecheck and the tests, and builds a binary for each system. It signs their `SHA256SUMS`, attaches the binaries, the signatures, and the installers to the release, and publishes the package to npm.

What happens depends on the version:

| Release           | Example                | npm dist-tag                                   | On GitHub         | Website     |
| ----------------- | ---------------------- | ---------------------------------------------- | ----------------- | ----------- |
| Stable            | `1.2.0`                | `latest`                                       | Marked Latest     | Rebuilt     |
| Release candidate | `1.2.0-rc.1`           | `rc`                                           | A pre-release     | Not changed |
| Backport          | `1.9.5` after `1.16.0` | `latest-<major>.<minor>`, such as `latest-1.9` | Not marked Latest | Not changed |

A backport is a stable version older than npm's `latest` of the same major version.

- The workflow signs with the repository secret `RELEASE_SIGNING_KEY`. Without it the workflow stops, because Circuit installs nothing unsigned. [SECURITY.md](SECURITY.md#signed-releases) explains the signatures and how to change the key.
- npm takes the package without a token, through npm Trusted Publishing.
- Each step skips what is already done, so you can run a failed workflow again.
- Circuit updates itself only within its major version, so a new major version reaches nobody by itself.
- Try a release candidate on a real network before it goes stable: run `circuit diff` against its devices.
- To release a security fix, follow [How a fix reaches users](SECURITY.md#how-a-fix-reaches-users).
