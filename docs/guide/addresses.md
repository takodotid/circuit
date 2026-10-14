# Finding a free address

`circuit addresses` lists every address your files use, grouped by [prefix](/guide/glossary#networking), and shows what is still free. You no longer have to search every device's file before you hand out an address.

It reads only your files and never logs in to a device.

```bash
npx circuit addresses                                 # everything
npx circuit addresses 10.0.0.0/16                     # only what is inside 10.0.0.0/16, and what is free there
npx circuit addresses 198.51.100.0/24 --length=29     # the free /29s in 198.51.100.0/24
npx circuit addresses --format=json                   # for a script or an AI agent
```

## What it shows

From the colocation pattern:

```
198.51.100.0/24, originated by edge-01
  198.51.100.8/29, 5 free, next 198.51.100.10
      198.51.100.9  edge-01 acme-internet
  free: 198.51.100.0/29, 198.51.100.16/28, 198.51.100.32/27, 198.51.100.64/26, 198.51.100.128/25

Outside the space the network originates
  10.0.99.0/24, 252 free, next 10.0.99.3
      10.0.99.1  edge-01 mgmt
      10.0.99.2  tor-01 mgmt
```

1. **The space your network owns** comes first: each prefix a device announces in `routing.bgp.networks`, or the prefix you give on the command line.
2. **Under it, each range a device has an address in**, with how many addresses are free and the lowest free one. Below that, every address in use and what uses it: an interface, a VRRP address, a DHCP pool or reservation, a WireGuard peer, the next hop of a static route, or a BGP neighbor.
3. **Blocks** follow the ranges: a loopback's address, a static route to a prefix no device has an address in, such as a block routed to a customer, and the addresses a WireGuard peer may send from.
4. **Free** lists every address that nothing uses, in as few prefixes as possible. With `--length=29`, it lists the free /29s instead, up to 16, and how many there are in all.
5. **Outside the space the network originates** lists the rest: management networks, links to a transit, an exchange's peering LAN.

It knows only what your files say. A host on a switch port, or an address a DHCP server gave out, is not in any file, so a DHCP pool counts as used from its first address to its last.
