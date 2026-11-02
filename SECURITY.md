# Security

Circuit logs in to network devices and changes their config, so a bug in it can reach a network. Please report one privately, and give us time to fix it before it's public.

## Reporting a vulnerability

Don't open a public issue. Instead:

- **On GitHub:** [report a vulnerability](https://github.com/takodotid/circuit/security/advisories/new) from the Security tab. Only the maintainers see it.
- **By email:** noc@tako.id.

Include:

- the Circuit version (`circuit --version`), your OS, and the device platform involved, such as RouterOS 7.23;
- what an attacker can do, and what they need first;
- steps or a config that shows it. Use documentation addresses, and leave out real passwords, keys and device output that holds them.

We'll confirm we got it, tell you what we find, and credit you in the fix release unless you'd rather not be named.

## Supported versions

Only the newest release of the current major version gets fixes: `latest` on npm, or the newest `rc` while Circuit 1 is a release candidate. Update with `circuit update` and check the problem is still there. A fix for something critical deprecates the versions before it, and those refuse to run until updated.

## What counts

A flaw in Circuit itself. For example:

- a secret leaving where it belongs: printed, logged, written to a file in plain text, or sent to Studio's page unencrypted. Studio decrypts in the browser, and the key is never sent;
- `circuit exec` sending a command that changes a device, when it should only read;
- the commit hook letting a plain-text secret or `.env.keys` through, when Circuit wrote the hook;
- Studio answering on a host name it wasn't told to allow, or reading a device when started with `--host`;
- an apply that leaves a device unreachable without rolling back, where the platform's safe apply should have caught it;
- an installer or `circuit update` installing a binary that doesn't match its release's `SHA256SUMS`;
- a published package that doesn't match this repository. Every version on npm carries a provenance statement from this repository's GitHub Actions; one without it isn't ours.

A flaw in a device's own software belongs to its vendor. A config that is unsafe as written, such as a firewall that allows too much, is the config's to fix; `validate` and its checks help find those.
