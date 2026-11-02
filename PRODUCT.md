# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary: network engineers at ISPs, internet exchanges, colocation providers, campuses and offices. Many know networking well and programming little. They edit one TypeScript file per device in an editor, and run `circuit validate`, `diff` and `apply` from a terminal.

Secondary: teammates who don't read TypeScript (NOC, support, managers) and look things up in Circuit Studio; readers new to networking, who learn in Circuit Academy.

## Product Purpose

Circuit is declarative, vendor-neutral network config. Each device is one file in a git repository. Circuit shows exactly what would change on a device, then makes the device match the file and nothing else. Success: every device runs exactly its file, every change was seen before it was sent, and git history is the network's history.

Three web surfaces:

- **Circuit Studio** (`src/studio/`), `circuit studio`: the network drawn, tables of everything in the files, tools to trace addresses and follow VLANs, compare with a git ref, and read a device live when asked.
- **The docs site** (`docs/`, circuit.tako.id), VitePress.
- **Circuit Academy** (`docs/academy/`): interactive lessons, networking from zero, then how each idea is written in Circuit.

## Positioning

One file per device is the whole truth: what the file leaves out is removed or reset. The same fields render to each vendor's own commands (MikroTik RouterOS 7, Huawei VRP, Raisecom ROS, Juniper Junos, Fortinet FortiOS). What a platform can't do is an error before anything is sent. Every platform was proved on a real device.

## Operating Context

- A network lives in its own git repo. Circuit is installed like an app; a full install pins Circuit in the project.
- `diff` and `apply` read the live device over SSH or a serial console. `apply` sends only after a yes. On RouterOS, Junos and FortiOS a change undoes itself if Circuit can't log in again.
- Studio runs on an engineer's laptop (127.0.0.1) or on a team server behind a login. It reads the files, and a device only when asked.
- Secrets are `secret("NAME")` references. `.env` is encrypted and committed; its key never is.

## Capabilities and Constraints

- Vendor syntax lives only in `src/platforms/<platform>/`.
- Circuit v1 is a release candidate until 1.0.0 and says so wherever it is installed.
- Off is the absence of a field: no `enabled: false`.

## Brand Commitments

- Names: **Circuit**, **Circuit Studio**, **Circuit Academy**. The home title: "Your network, written down."
- Voice: plain, everyday English for engineers who aren't programmers. Answer first, steps as numbered lists, no em-dashes, nothing personal.
- Examples use real names engineers know (transit providers, exchanges), with documentation addresses.
- Licensed by PT Hobimu Jadi Cuan under the Business Source License 1.1; licensing questions to legal@tako.id. Maintained by the Tako Network Engineering Team, noc@tako.id.

## Evidence on Hand

- Production user: Tako (`docs/public/users/tako.png`). No other confirmed users.
- Studio screenshots: `docs/public/screenshots/`. Example projects: `examples/`.
- No testimonials, benchmarks or adoption figures exist. Never invent them.

## Product Principles

1. **The files are the truth.** Never imply state Circuit doesn't have.
2. **Show the change first.** The step that touches a device stays with a person.
3. **Readable by the whole team.**
4. **Honest about limits.** Release-candidate status and unsupported fields are stated plainly.
5. **Modest presence.**
