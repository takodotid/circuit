# Network

This repository describes the network with [Circuit](https://circuit.tako.id). Each device has a file; Circuit makes the device match it.

```bash
npm install                     # once
npx circuit secrets             # check every secret can be read
npx circuit validate            # check the files
npx circuit snapshot            # read what each device runs now
npx circuit diff                # see what would change
npx circuit apply <device>      # see the plan against the device
npx circuit apply <device> --confirm
```

Secrets go in `.env`, which is never committed. `.circuit/` is written by Circuit; commit it, but never edit it.
