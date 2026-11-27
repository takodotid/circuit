# Security

## Reporting a vulnerability

Report it privately, never in a public issue, and give the maintainers time to fix it before it's public:

- **On GitHub:** [report a vulnerability](https://github.com/takodotid/circuit/security/advisories/new) from the Security tab. Only the maintainers see it.
- **By email:** noc@tako.id.

Include:

- the Circuit version (`circuit --version`), your OS, and the device platform involved, such as RouterOS 7.23;
- what an attacker can do, and what they need first;
- steps or a config that shows it. Use documentation addresses, and leave out real passwords, keys, and device output that holds them.

The maintainers confirm they got it and tell you what they find. The fix release credits you, unless you'd rather not be named.

## Supported versions

The newest release of the current major version gets fixes: `latest` on npm. An older line, such as 1.9.x beside 1.16.x, can also get a security fix as a backport. Before you report, update with `circuit update` and check that the problem is still there.

## What counts

A flaw in Circuit itself. For example:

- a secret printed, logged, written to a file in plain text, or sent to Studio's page unencrypted;
- `circuit exec` sending a command that changes a device;
- Circuit sending a password or a key to a device, or to a console's jump host, before it checked the SSH host key against `known_hosts`, or after the key matched none known for that host ([Host keys](https://circuit.tako.id/guide/apply#host-keys));
- the commit hook Circuit wrote letting a plain-text secret through;
- a secrets file that opens without its password, or a value that opens under another name;
- Studio answering on a host name it wasn't told to allow, or reading a device when started with `--host`;
- an apply that leaves a device unreachable without rolling back, where the platform's safe apply should have caught it;
- Circuit or an installer installing a binary whose `SHA256SUMS` isn't signed with the release key, or that doesn't match it;
- a version an advisory affects running a command, or being offered by `circuit update`;
- a version on npm without a provenance statement from this repository's GitHub Actions.

A flaw in a device's own software belongs to its vendor. A config that is unsafe as written, such as a firewall that allows too much, is the config's to fix.

## How a fix reaches users

A version with a security problem gets a GitHub security advisory on this repository, which `npm audit` reads too. Each advisory gives the versions it affects, such as `>= 1.10.0, < 1.16.0` and `< 1.9.5`, and the versions that fix it, such as `1.16.0` and `1.9.5`. Every advisory counts, whatever its severity.

- Circuit reads the advisories at most every 2 minutes, without signing in.
- A project on an affected version runs nothing until it moves. Circuit offers only fixed versions, and always the one closest to the project's.
- In CI, the command stops and lists the fixed versions.
- Circuit never updates itself to an affected version.

To publish a fix:

1. Fix it on each supported line. Release the newest (`1.16.0`) first. Then release each backport (`1.9.5`) from a branch for its line, tagged `v1.9.5`.
2. On GitHub, go to **Security > Advisories > New draft security advisory**. Fill in ecosystem npm, package `@takodotid/circuit`, the affected range for each line, the patched versions, and the severity.
3. Publish it. Every Circuit sees it within 2 minutes.
4. To show it on npm installs too, run `npm deprecate "@takodotid/circuit@<range>" "Security: GHSA-..., update to 1.16.0 or 1.9.5"`. This needs an npm login.

Never unpublish a version, because projects pin it. If someone changed a binary itself, also delete its files from the GitHub release.

## Signed releases

The release workflow signs each release's `SHA256SUMS` with Circuit's Ed25519 release key, the repository secret `RELEASE_SIGNING_KEY`, in two formats:

| File                | Format               | Checked by                                                                                                       |
| ------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `SHA256SUMS.sig`    | Ed25519, base64      | Circuit, when it updates itself, on `circuit update`, and when it downloads a project's version                  |
| `SHA256SUMS.sshsig` | `ssh-keygen -Y sign` | The install commands (`curl ... \| sh`, `irm ... \| iex`), and Tako's Homebrew tap before it updates its formula |

Circuit and the installers install a binary only when a key they carry signed `SHA256SUMS` and the binary matches it. The installers use `ssh-keygen -Y verify`, because PowerShell 5.1 and macOS's `openssl` have no Ed25519. Without `ssh-keygen`, they install nothing.

To change the key, add the new public key beside the old one in `src/cli/signing.ts`, in both installers, and in the tap's `scripts/circuit-release.allowed_signers` (takodotid/homebrew-tap), and release. Then switch the secret to the new private key.

## How secrets are encrypted

Each value in a secrets file is encrypted on its own. The names stay readable, so git shows which secret changed.

- AES-256-GCM, with a new random 12-byte IV for each value. A value changed by hand fails to open, instead of opening wrong.
- The key is made from the file's password by scrypt (N = 2^17, r = 8, p = 1), with a random 16-byte salt per file. A new password gets a new salt.
- The secret's name is bound to its value as additional data, so a value moved to another name doesn't open.
- The password is never in the file. [Secrets](https://circuit.tako.id/guide/secrets) says where Circuit gets it.
- Studio decrypts in the browser with the same scheme. The password never leaves the page.

Circuit asks for a password of at least 12 characters. If you leave it empty, Circuit makes one of 32 characters.
