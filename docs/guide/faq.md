---
description: Quick answers to the questions people ask first.
---

# Frequently asked questions

## Rename a device

Run `circuit rename <device> <new-name>`, then `circuit apply` the device so it gets its new hostname. See [rename](/reference/cli#rename).

## Rename a site

1. Change its name under `sites` in `circuit.ts`.
2. Change `site` in each of its devices. The editor marks the ones you missed.
3. Rename its folder under `sites/`, and fix the imports into it.

Nothing changes on the devices. If you sync NetBox or LibreNMS, run `circuit sync` again.

## More than one AS number

- **Some routers use another AS:** set `routing.bgp.asn` on those routers.
- **Separate networks, each with its own prefixes and communities:** write one `circuit()` for each in `circuit.ts`. See [The network](/guide/project#the-network).
- **Networks run by different teams:** use one repository per network, so each team has its own history, secrets, and access.

## Things the device makes by itself

Circuit removes only configuration that your file doesn't have. It leaves alone what the device makes by itself, such as the dynamic fasttrack rule on RouterOS.

## Start on a device in production

The first plan removes everything that your file doesn't have yet. So:

1. See what the device runs with `circuit exec`, such as `/export` on RouterOS.
2. Write the file to match what should stay.
3. Run `circuit diff <device>` until the plan shows only what you want.
4. Then run `circuit apply <device>`.

## How much TypeScript you need

Very little. A project is plain data, and your editor fills in the fields. Only your own checks in `lib/` need a bit of TypeScript.

## Other programs you may need

Circuit needs no other program, except for these features:

| Program                | Used for                                                                   |
| ---------------------- | -------------------------------------------------------------------------- |
| `ssh-keygen` (OpenSSH) | The install command, to check that a download is signed.                   |
| `git`                  | The [commit check](/guide/secrets#the-commit-check), and Studio's history. |
| `op` (1Password CLI)   | Secrets and passwords kept in [1Password](/integrations/1password).        |
| `cloudflared`          | A console jump host behind a Cloudflare Tunnel.                            |
| Bun                    | A [full install](/guide/install#full-install).                             |
