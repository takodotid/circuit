# Product

## Users

Primary: network engineers at ISPs, internet exchanges, colocation providers, campuses, and offices. Many know networking well and programming little. They edit one TypeScript file per device in an editor, and run `circuit validate`, `diff`, and `apply` from a terminal.

Secondary: teammates who don't read TypeScript (NOC, support, managers) and look things up in Circuit Studio; readers new to networking, who learn in Circuit Academy.

## Product purpose

Circuit is declarative, vendor-neutral network config. Each device is one file in a git repository. Circuit shows exactly what would change on a device, then makes the device match the file and nothing else. Success: every device runs exactly its file, every change was seen before it was sent, and git history is the network's history.

Three web surfaces:

- **Circuit Studio** (`src/studio/`), `circuit studio`: the network drawn, tables of everything in the files, tools to trace addresses and follow VLANs, compare with a git ref, and read a device live when asked.
- **The docs site** (`docs/`, circuit.tako.id), VitePress.
- **Circuit Academy** (`docs/academy/`): interactive lessons, networking from zero, then how each idea is written in Circuit.

## Positioning

One file per device is the whole truth: what the file leaves out is removed or reset. The same fields render to each vendor's own commands (MikroTik RouterOS 7, Huawei VRP, Raisecom ROS, Juniper Junos, Fortinet FortiOS). What a platform can't do is an error before anything is sent. Every platform was tested on a real device.

## Operating context

- A network lives in its own git repo. Circuit is installed like an app; a full install pins Circuit in the project.
- `diff` and `apply` read the live device over SSH or a serial console. `apply` sends only after a yes. On RouterOS, Junos, and FortiOS a change undoes itself if Circuit can't log in again.
- Studio runs on an engineer's laptop (127.0.0.1) or on a team server behind a login. It reads the files, and a device only when asked.
- Secrets are `secret("NAME")` references. `.circuit/secrets` is encrypted and committed; its password never is.

## Brand

- The names are **Circuit**, **Circuit Studio**, and **Circuit Academy**. The home title is "Your network, written down."
- Voice: the writing rules in [AGENTS.md](AGENTS.md#writing). Answer first, steps as numbered lists, nothing personal.

## Evidence on hand

- Production user: Tako (`docs/public/users/tako.png`). No other confirmed users.
- Studio screenshots: `docs/public/screenshots/`. Example projects: `examples/`.
- No testimonials, benchmarks, or adoption figures exist. Never invent them.

## Product principles

1. **The files are the truth.** Never imply state Circuit doesn't have.
2. **Show the change first.** The step that touches a device stays with a person.
3. **Readable by the whole team.**
4. **Honest about limits.** Say plainly what a platform doesn't support.
5. **Modest presence.**
