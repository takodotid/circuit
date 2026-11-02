---
description: Quick answers to the questions people ask first.
---

# FAQ

## How do I rename a device?

`circuit rename <device> <new-name>`. It shows every change, writes once you say yes. Then `circuit apply` the device so it gets its new hostname. See [rename](/guide/cli#rename).

## How do I rename a site?

1. Change it in `circuit.ts`, under `sites`.
2. Change `site` in each device. The editor flags the ones you missed.
3. Rename the folder under `sites/`, and fix imports into it.

No device changes: a site is just a name to Circuit.

## My network has more than one AS number. What do I do?

- **Some routers use another AS?** One network is enough. Set `routing.bgp.asn` on those routers.
- **Separate networks, with their own prefixes and communities?** Write one `circuit()` each in `circuit.ts`, like `as64500` and `as64501`. See [The network](/guide/project#the-network).
- **Run by different teams?** One repo per network, so each team has its own history, secrets and access.

## My device shows something the file does not have. Will Circuit remove it?

Only if it's configuration. Things the device makes by itself, like RouterOS's dynamic fasttrack rule, are left alone.

## Can I use Circuit on a device that is already in production?

Yes, carefully. The first plan removes everything your file doesn't have yet. So:

1. Look at what it runs: `circuit exec`, like `/export` on RouterOS or `display current-configuration` on VRP.
2. Write the file to match what should stay.
3. `circuit diff <device>` until the plan shows only what you want.
4. Then `circuit apply <device>`.

## Do I need to learn TypeScript?

Not really. A project is plain data: names, numbers, lists. Your editor fills in fields and flags mistakes as you type. Only your own checks in `lib/` need a bit of TypeScript.

## Do I need to install anything else?

No. `circuit` has everything inside.

## Will updating Circuit break my project?

No. Each project runs the version in its `.circuit-version`. A project moves only when you run `circuit update` in it and say yes.

## Can I run Circuit in CI?

Yes. Install it with the same command, set `DOTENV_PRIVATE_KEY` from your CI's secrets, and run `circuit validate`. To apply from CI, add `--confirm`: without a terminal, `apply` won't send otherwise.

## How do I remove Circuit?

`circuit uninstall`. It asks first, and never touches your projects.
