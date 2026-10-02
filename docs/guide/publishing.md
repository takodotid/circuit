# Publishing the network

Some of the config describes the network to others rather than configuring a device. Devices ignore it.

## PeeringDB

Mark the interface that is the network's presence at an internet exchange:

```ts
interfaces: {
    "ix-lan": {
        type: "vlan",
        vlan: "ix",
        addresses: ["192.0.2.10/24", "2001:db8:1::10/64"],
        exchange: { name: "Example IX", speed: 10_000, peeringdb_ixlan: 1234 },
    },
},
```

and give the network its `asn` and a `peeringdb` API key with write access to its record. `circuit peeringdb` then compares every interface with a `peeringdb_ixlan` against PeeringDB's records:

- the speed;
- the interface's globally reachable addresses, so an exchange reached over a tunnel on private space is not published;
- whether a BGP neighbor on the interface is a route server.

It prints the changes and sends them with `--confirm`. A record PeeringDB holds that the config does not is reported, never deleted.

## BGP communities

```ts
communities: [
    { community: "64500:1:1", description: "Learned from a transit" },
    { community: "64500:0:nnn", description: "Do not announce to AS$0" },
    { community: "64500:x:nnn", description: "Prepend $0 times to AS$1" },
],
```

`circuit communities` prints them one per line, `community,description`, in the format the [NLNOG Ring looking glass](https://github.com/NLNOG/lg.ring.nlnog.net) defines and bgp.tools reads:

- `nnn` is any number, `x` one digit, `a-b` a range;
- `$0`, `$1` in the description are what each wildcard matched, in order.
