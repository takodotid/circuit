# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary: network engineers at operators such as small-to-mid ISPs, internet exchanges and colocation providers. They own each device's TypeScript file, write changes in their editor, and run `circuit diff` and `circuit apply` from a terminal. Their job is to change a production network without surprises and keep its history in git.

Secondary: people on the same team who do not read TypeScript (NOC, support, managers) and look things up in Circuit Studio; and readers new to networking or to network automation, for whom the documentation is written.

## Product Purpose

Circuit is a declarative, vendor-neutral network configuration framework. Each router and switch is described in one TypeScript file in a git repository. Circuit shows exactly what would change on a device, then makes the device match the file and nothing else. Success is a network whose every device runs exactly its file, where every change was seen before it was sent, and where the repository's history is the network's history.

The product has three web surfaces:

- **Circuit Studio** (`src/studio/`), started with `circuit studio`: a drawing of the network and tables of everything the files hold, plus tools to trace addresses, follow VLANs, test packets and route policies, and compare branches.
- **The documentation site** (`docs/`, circuit.tako.id), built with VitePress: guides, patterns, use cases, platform pages and the schema reference.
- **Circuit Academy** (`docs/academy/`), on the same site with a sidebar of its own: interactive lessons that teach networking from zero (Beginner, Elementary, Intermediate) and then how each idea is written in Circuit. Progress is kept in the reader's browser; each lesson has a discussion through GitHub Discussions. A certification, given on request, is announced as coming soon, with a graduates page that checks certificates by ID.

## Positioning

One file per device is the whole truth: anything the file does not mention is removed or returned to its default, so nothing set by hand lingers. The same field names render to each vendor's own commands (MikroTik RouterOS 7, Huawei VRP, Raisecom ROS, Juniper Junos, Fortinet FortiOS), and what a platform cannot express is an error before anything is sent. Every supported platform was proved on a real device before release.

## Operating Context

- A network lives in its own git repository and depends on Circuit; Circuit itself holds no particular network's names, addresses or policies.
- Engineers work in an editor with TypeScript checking every name as they type, and in a terminal. `diff` works offline, `apply` plans against the live device over SSH, and nothing is sent without `--confirm`. On RouterOS, Junos and FortiOS a change undoes itself if Circuit cannot log in again.
- Studio is used on an engineer's own laptop beside the editor while writing or reviewing a change, and on a shared team server behind a login so the whole team can look things up. It reads only the files and the last snapshot and never logs in to a device. Locally it answers only on 127.0.0.1:4600; it has no login of its own, so a hosted copy must sit behind a reverse proxy with a login or a VPN.
- Secrets come from `.env` or 1Password as `secret("NAME")` references and never appear in a plan, a snapshot or Studio.
- AI coding agents work on network repositories through the `AGENTS.md` that `circuit new` writes; the final apply stays with a person.
- Integrations keep other systems in step: prefix lists from registries, PeeringDB, LibreNMS, Prometheus, WireGuard client configs, and BGP communities for a looking glass.

## Capabilities and Constraints

- Platforms: MikroTik RouterOS 7, Huawei VRP, Raisecom ROS, Juniper Junos 21, Fortinet FortiOS 6.2, each at the versions in `docs/platforms/index.md`. Vendor syntax lives only in `src/platforms/<platform>/`.
- Studio views: Graph, Devices, VLANs, Addresses, BGP, Cables, Tools, Compare, Problems. Each page has its own URL hash so back and bookmarks work. `circuit studio --json` prints the same data; `circuit graph` prints the drawing as Mermaid, DOT or JSON.
- Studio's page is plain HTML, CSS and browser JavaScript in `src/studio/public/`, typed with JSDoc and checked by `bun run typecheck`, with no build step. A saved file reloads an open page. It must work offline, falling back to system fonts.
- The docs site is VitePress with a custom home (`docs/.vitepress/theme/home/`). Pattern and platform pages include files from `templates/` and each adapter's `TRAPS.md` rather than repeating them.
- `src/` uses Node's APIs, never Bun's, so both runtimes run it.
- Circuit is alpha until 1.0.0 and must say so wherever it is installed.
- Terminology: device, config, snapshot, plan, diff, apply, pattern, preset, check, use case. Off is the absence of a field: there is no `enabled: false`. The glossary at `docs/guide/glossary.md` defines niche terms.

## Brand Commitments

- Names: **Circuit** and **Circuit Studio**. The docs home's title line is "Your network, written down."
- Voice: plain English for every reader, including someone new to networking. The direct answer first, a process as numbered steps, niche words explained or linked to the glossary, no em-dashes. Name no person or vendor unless the sentence needs it.
- Attribution stays modest: the license, the copyright line and the credits page, no more.
- Licensed by PT Hobimu Jadi Cuan under the Business Source License 1.1; licensing questions go to legal@tako.id. Maintained by the Tako Network Engineering Team, noc@tako.id.
- Existing assets: `docs/public/favicon.svg` and `src/studio/public/favicon.svg`.

## Evidence on Hand

- Production user: Tako, with its logo at `docs/public/users/tako.png`. No other users are confirmed.
- Studio screenshots in light and dark: `docs/public/screenshots/`.
- Working configs: `examples/` (including a full multi-site setup and use-case networks) and `templates/` (single site, edge router, colocation), all validated by the test suite.
- Academy illustrations in the plate style: `docs/public/illustrations/academy/`. No graduates exist yet; the graduates list is empty until the certification opens.
- No testimonials, case studies, benchmarks, adoption figures or press exist. Future work must not invent them. Pricing is only what the license states: free in production under US$100,000 yearly revenue and funding, a commercial license above that.

## Product Principles

1. **The files are the truth.** Every surface shows what the files and the last snapshot say, and never implies state it does not have.
2. **Show the change before it happens.** Make the difference visible and reviewable; the step that touches a device stays with a person.
3. **Readable by the whole team.** An engineer and someone who does not read TypeScript should both find the answer, in plain words.
4. **Honest about limits.** Alpha status, unsupported fields and what is broken are stated plainly, never softened or hidden.
5. **Modest presence.** Circuit serves the network it describes; it does not promote itself or its maker.

## Accessibility & Inclusion

No formal standard is committed to. Good practice applies; do not claim conformance to a standard.
