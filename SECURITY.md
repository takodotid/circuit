# Security

Circuit logs in to network devices and changes their config, so a flaw in it can reach a network. Please report one privately, and give us a chance to fix it before it is public.

## Reporting a vulnerability

Don't open a public issue. Instead:

- **On GitHub:** [report a vulnerability](https://github.com/takodotid/circuit/security/advisories/new) from the repository's Security tab. Only the maintainers see it.
- **By email:** noc@tako.id, if you can't use GitHub.

Please include:

- the Circuit version (`npm ls @takodotid/circuit`), the Node.js or Bun version, and the platform involved, such as RouterOS 7.23;
- what an attacker can do, and what they need first;
- the steps or a config that shows it. Use documentation addresses and made-up names, and leave out real passwords, keys and device output that holds them.

We'll confirm we got it, tell you what we find, and credit you in the release that fixes it unless you'd rather not be named.

## Supported versions

Circuit is alpha. Only the latest release on npm gets fixes, so upgrade to it first and check the problem is still there.

## What counts

A flaw in Circuit itself. For example:

- a secret from `.env`, 1Password or a device leaving where it belongs: printed, logged, written to `.circuit/state/`, sent to an integration, or shown in Studio;
- `circuit show` sending a command that changes a device, when it should only read;
- Studio answering on a host name it wasn't told to allow;
- an apply that leaves a device unreachable without rolling back, when the platform's safe apply should have caught it;
- a published package that doesn't match this repository. Every version on npm from 0.5 on carries a provenance statement from this repository's GitHub Actions; a later one without it is not ours.

A flaw in a device's own software belongs to its vendor. A config that is unsafe as written, such as a firewall that allows too much, is the config's to fix; `validate` and its checks are there to help find those.
