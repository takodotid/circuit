---
title: Management on its own network
description: Manage every device from a network of its own, and let only that network reach the device's login services. Circuit states it with management.allow.
---

# Management on its own network

Manage every device from a network of its own, and let only that network reach the device's login services.

## Why

Whoever logs in to a device controls the traffic through it. A login service that answers the whole internet can be tried by anyone, and a flaw in it gives the device away without a password.

In 2021, the Mēris botnet set a record of 21.8 million requests a second, with floods from tens of thousands of routers. Their vendor said most had been broken into in 2018, through a flaw in a management service. The flaw was patched that year, but updating didn't close a router whose stolen password was never changed. A router that answers management only from its own network can't be reached that way.

A VLAN of its own keeps management off the ports anyone can plug into. A guest at a wall socket, or a customer on its port, never lands on the network that may log in.

## In Circuit

`management.allow` lists the sources that may reach every login service, as prefixes or as the name of an address set. A service can set its own `allow`, and a service you leave out is off. Each device of the [single site example](/guide/examples#a-single-site) allows only the management network, and turns on SSH alone:

```ts
management: { allow: [home.addresses.management], ssh: {} },
```

The management VLAN travels only on the trunk between the two devices. The example's own check fails on any access port in it:

<<< @/../examples/single-site/lib/checks.ts

`management.interfaces` also limits the ports and interfaces the services answer on. [Keeping the keys](/academy/elementary/management) covers users and passwords, and how not to lock yourself out.

## Further reading

- [MikroTik on the Mēris botnet](https://mikrotik.com/supportsec/meris-botnet/).
- [An analysis of the record attack](https://blog.qrator.net/en/meris-botnet-climbing-to-the-record_142/).
