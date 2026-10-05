# Publishing the network

A network with its own AS number also tells the rest of the internet about itself: which exchanges it is on, and what its BGP communities mean. Circuit keeps that information in the same files as the config, so it is always up to date. Devices ignore it.

## PeeringDB

[PeeringDB](https://www.peeringdb.com) is where networks list the internet exchanges they are on, so others can find them and peer with them. Circuit can keep your record there up to date.

1. Mark each interface on an exchange's peering LAN with the exchange's details:
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
    `peeringdb_ixlan` is the exchange LAN's ID on PeeringDB. `speed` is your port speed in Mbit/s.
2. In `circuit.config.ts`, add your `asn`, and a `peeringdb` API key that can edit your network's record:
    ```ts
    asn: 64500,
    peeringdb: { api_key: secret("PEERINGDB_API_KEY") },
    ```
3. Run `bun circuit peeringdb`. It compares each marked interface with PeeringDB and prints what differs:
    - the port speed;
    - the addresses, but only the ones reachable from the internet, so an exchange you reach over a tunnel on private addresses is not published;
    - whether you have a BGP session with the exchange's route server.
4. Run `bun circuit peeringdb --confirm` to send the changes.

If PeeringDB lists an exchange your config does not, Circuit reports it but never deletes it. Remove it by hand if you really left.

## BGP communities

A BGP community is a tag on a route. Your network can use them to remember where a route came from, and your customers can use them to ask you to do something with their routes, such as not announce them to a certain AS.

Publish what each of your communities means, so others can read your routes:

```ts
communities: [
    { community: "64500:1:1", description: "Learned from a transit" },
    { community: "64500:100:nnn", description: "Do not announce to AS$0" },
],
```

`bun circuit communities` prints them one per line, as `community,description`. This is the format of the [NLNOG Ring looking glass](https://github.com/NLNOG/lg.ring.nlnog.net), which bgp.tools also reads. In a community:

- `nnn` matches any number;
- `x` matches one digit;
- `a-b` matches a range of numbers.

In the description, `$0` is what the first of these matched, `$1` the second, and so on.

### One scheme for routers and catalogue

Writing the list above by hand means your routers and your published list can drift apart. The `communityScheme` preset builds both from one definition: the rules your routers use, and the list you publish. See [Presets](/guide/presets#bgp-communities).
