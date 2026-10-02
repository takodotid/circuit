# AGENTS.md

Circuit is a declarative, vendor-neutral network configuration framework. It knows no particular network: a network lives in its own repository and depends on Circuit.

## Rules

1. The config is the whole truth. A device runs exactly its config; anything else is removed or returned to its default.
2. No particular network's names, addresses or policies in this repository. Vendor syntax lives only in `src/adapters/devices/<platform>/`.
3. A field is written when it has a value. No `enabled: false`, no `admin_state`, no placeholders, nothing marked reserved or spare. Off is the absence of the field.
4. Every schema field has a comment, shown on hover in the editor.
5. A field a platform cannot express is listed in that adapter's `unsupported()`. Never skip one silently.
6. Secrets are `secret("NAME")` references. Rendered config, plans and snapshots never hold a value.
7. `bun run typecheck` and `bun run test` must pass. The pre-commit hook runs both.
8. When unsure, ask. Never guess on anything a device does differently from what its documentation says: prove it on a device.

## Writing

English only. Short, neutral, plain. No em-dashes, no decorative comments, no manual line wrapping. Name no person or vendor unless the sentence needs it. Document only what is needed and delete what is not; git history is the archive.

Code is written to be read: names that say what a value is, one step per line, a blank line between steps, and an object with more than a few fields spread over lines. Readability never means splitting a file; a platform's adapter stays in its own few files. Prettier keeps an object expanded when its source has a newline after `{`.

## Changing an adapter

Read the platform's `TRAPS.md` first, and add to it what the change taught. New syntax is proved on a device without applying it: on RouterOS, `:put [:parse "..."]` compiles a command without running it; on VRP, lines go into the candidate and `clear configuration candidate` discards them; Raisecom applies at once, so only a spare port is safe.

`examples/` uses every field each adapter supports, and `test/` checks each example plans nothing against its own render. A reader and renderer that disagree on a form show up there before they show up as a change on every apply.

`docs/` is the documentation site at circuit.tako.id. A change to what Circuit does changes the page that describes it in the same commit. Platform pages include each adapter's `TRAPS.md`.

Commits follow Conventional Commits with a scope from `commitlint.config.js`. Releases are cut with `bun run release`, which tags `vX.Y.Z` or `vX.Y.Z-rc.N`; the tag publishes to npm and GitHub Packages, and a GitHub release. Circuit is alpha until 1.0.0: say so wherever it is installed.

Circuit is licensed by PT Hobimu Jadi Cuan under the Business Source License 1.1 in `LICENSE`. Licensing questions go to legal@tako.id; the maintainers are the Tako Network Engineering Team, noc@tako.id. Attribution stays modest: the license, the copyright line and the credits page, no more.

Use the `gh` CLI for anything on GitHub: issues, pull requests, releases, repository settings.
