# Contributing

To report a bug, ask a question, or fix the docs, see [Contributing](https://circuit.tako.id/contributing) on the website. Report a vulnerability as [SECURITY.md](SECURITY.md) says. Everyone follows the [Code of Conduct](CODE_OF_CONDUCT.md).

The rules for code, writing, checks, and commits are in [AGENTS.md](AGENTS.md). They apply to people and AI agents alike.

## Set up

Install [Bun](https://bun.sh), then:

```bash
bun install             # also builds Studio's page and the editor types, and sets up Vale and the git hooks
bun install --cwd docs  # the website's dependencies, which the checks read too
bun run docs:dev        # the website, locally
```

`bun run format` formats every file.

## Pull requests

Branch from `main`, and name the branch `feat/...`, `fix/...`, `docs/...`, or `chore/...`. In the pull request, say what changes, why, and what a reviewer should try. CI must pass. A maintainer merges it with `gh pr merge --rebase --delete-branch`. Merging releases nothing.

## Releases

Only maintainers release. AI agents use the skill `release`.

1. On `main`, change `version` in `package.json` and `src/cli/version.ts`. Commit it as `chore(release): vX.Y.Z` and push.
2. Create a GitHub release from `main` with the tag `vX.Y.Z`. A release candidate is `vX.Y.Z-rc.N`, marked as a pre-release. A backport is released from a branch for its line.
3. `.github/workflows/release.yml` runs the typecheck and the tests, and builds a binary for each system. It signs their `SHA256SUMS`, attaches the binaries, the signatures, and the installers to the release, and publishes the package to npm.

| Release           | Example                | npm dist-tag                                   | On GitHub         | Website     |
| ----------------- | ---------------------- | ---------------------------------------------- | ----------------- | ----------- |
| Stable            | `1.2.0`                | `latest`                                       | Marked Latest     | Rebuilt     |
| Release candidate | `1.2.0-rc.1`           | `rc`                                           | A pre-release     | Not changed |
| Backport          | `1.9.5` after `1.16.0` | `latest-<major>.<minor>`, such as `latest-1.9` | Not marked Latest | Not changed |

A backport is a stable version older than npm's `latest` of the same major version.

- The workflow signs with the repository secret `RELEASE_SIGNING_KEY`, and stops without it. [Signed releases](SECURITY.md#signed-releases) says how to change the key.
- npm takes the package through npm Trusted Publishing, without a token.
- Each step skips what is already done, so you can run a failed workflow again.
- Circuit updates itself only within its major version, so a new major version reaches nobody by itself.
- Before a release candidate goes stable, run `circuit diff` with it against a real network's devices.
- To release a security fix, follow [How a fix reaches users](SECURITY.md#how-a-fix-reaches-users).
