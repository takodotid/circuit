# Network

This repository describes the network with [Circuit](https://circuit.tako.id). Each device has a file; Circuit makes the device match it.

```bash
bun install                     # once
bun circuit secrets             # check every secret can be read
bun circuit validate            # check the files
bun circuit snapshot            # read what each device runs now
bun circuit diff                # see what would change
bun circuit apply <device>      # see the plan against the device
bun circuit apply <device> --confirm
```

Secrets go in `.env`, which is never committed. `.circuit/` is written by Circuit; commit it, but never edit it.
