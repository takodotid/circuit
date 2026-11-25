---
description: Validate every push, find drift on a schedule, and apply from a pipeline, with nobody there to answer.
---

# Run in CI

## Check every push

This GitHub Actions job checks every push:

```yaml
# .github/workflows/circuit.yml
name: circuit
on: [push, pull_request]

jobs:
    check:
        runs-on: ubuntu-latest
        steps:
            - uses: actions/checkout@v7
            - name: Install Circuit
              run: |
                  curl -fsSL https://circuit.tako.id/install | CIRCUIT_NO_SETUP=1 sh
                  echo "$HOME/.local/bin" >> "$GITHUB_PATH"
            - run: circuit validate
            - run: circuit fmt --check
```

`CIRCUIT_NO_SETUP=1` installs Circuit only, and skips setting up the project for an editor. `validate` and `fmt` read only the project, so they need no password and no device.

## Without a terminal

- **Circuit asks nothing.** A command that needs a yes stops and sends nothing. Add `--confirm` to `apply`, `sync`, `rename`, or `update` to go ahead.
- **Circuit downloads the project's version without asking.** On your machine, it asks first.
- **A version with a security problem stops the job.** The message gives the fixed versions. Move the project with `circuit update` in a terminal, and commit `.circuit/version`.

## Read and change devices

`diff`, `apply`, `exec`, and `bgp` log in to the devices over SSH. So the job must run where it can reach them, such as on a self-hosted runner in your management network.

These commands need the password that opens your secrets. So does `sync` when the target's token is a secret. Put the password in your CI's secrets, and give it to the step as `CIRCUIT_SECRETS_PASSWORD`.

Circuit checks each device's [host key](/guide/apply#host-keys) against `~/.ssh/known_hosts`. A self-hosted runner keeps that file from one run to the next. A runner that starts empty would take any key the first time it logs in, so write the keys first, in a step such as `mkdir -p ~/.ssh && cat known_hosts >> ~/.ssh/known_hosts`, from a `known_hosts` file you keep in the repository.

This workflow applies `edge-01` every night, which keeps [prefix sets from a registry](/guide/apply#prefix-sets-from-a-registry) current:

```yaml
# .github/workflows/apply.yml
name: apply
on:
    schedule:
        - cron: "0 3 * * *" # every night at 03:00 UTC

jobs:
    apply:
        runs-on: self-hosted
        steps:
            - uses: actions/checkout@v7
            - name: Install Circuit
              run: |
                  curl -fsSL https://circuit.tako.id/install | CIRCUIT_NO_SETUP=1 sh
                  echo "$HOME/.local/bin" >> "$GITHUB_PATH"
            - run: circuit apply edge-01 --confirm
              env:
                  CIRCUIT_SECRETS_PASSWORD: ${{ secrets.CIRCUIT_SECRETS_PASSWORD }}
```

To only find drift, run `circuit diff edge-01` instead. It sends nothing, and fails the job if the device doesn't match its file.

If you keep the password in 1Password, set `CIRCUIT_SECRETS_PASSWORD` to its `op://` reference instead. The job then needs the 1Password CLI and a service account. See [1Password](/integrations/1password).

## Exit codes

Each command exits 0 when all is well, and 1 in these cases.

| Command                       | Exits 1 when                                                                                                      |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `circuit validate`            | the project has an error.                                                                                         |
| `circuit fmt --check`         | a file needs tidying.                                                                                             |
| `circuit diff <device>`       | the device doesn't match its file.                                                                                |
| `circuit apply <device>`      | it sends nothing because `--confirm` is missing, or a [check afterwards](/guide/apply#checking-afterwards) fails. |
| `circuit sync <target>`       | the other system differs from the project and nothing was sent, or it still differs after sending.                |
| `circuit bgp <device> --wait` | the sessions aren't up in time.                                                                                   |

Every command also exits 1 on an error, such as a device it can't reach.
