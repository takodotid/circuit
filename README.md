# Circuit

Declarative, vendor-neutral network configuration. Describe each device in TypeScript, and Circuit renders it for the platform, compares it with what the device runs, and makes the device match.

Documentation: [circuit.tako.id](https://circuit.tako.id)

> [!WARNING]
> Circuit is in alpha. It runs a production network, but it is not yet stable: the schema, the CLI and the adapters can still change in breaking ways between releases. Pin an exact version and read the release notes before upgrading.

## Principles

1. **The config is the whole truth.** Whatever a device runs that its config does not say is removed, or returned to its default. There are no exceptions and nothing is left alone.
2. **Absent means off.** A field is written when it has a value. An undeclared port is shut down, an undeclared service is disabled, an undeclared feature is not running. There is no `enabled: false` and no placeholder.
3. **Neutral words only.** The schema says `access_vlan`, `https`, `hardware_offload`. Each adapter translates, and a field a platform cannot express fails validation instead of being skipped.
4. **Names are checked.** A device declares its VLANs, interfaces, policies and the rest; every reference to one is type-checked, so a typo does not compile and the editor suggests the names that exist. Port names come from the hardware model.
5. **Secrets are references.** `secret("NAME")` is resolved from the environment or `.env.local`, and `secretFile("path")` from a file kept out of git, only when a command is sent. Rendered config, plans and snapshots never hold a secret.

## Install

Circuit runs on [Bun](https://bun.sh) and ships as TypeScript source, on npm and GitHub Packages.

```bash
bun add --exact @takodotid/circuit
```

Add `"net": "circuit"` to the project's `scripts` to run it as `bun net`. Every release is on the [releases page](https://github.com/takodotid/circuit/releases); release candidates are tagged `-rc.N` and published under the `rc` dist-tag.

## A device

```ts
import { defineDevice, secret } from "@takodotid/circuit";

export default defineDevice({
    name: "sw1",
    platform: "vrp",
    model: "CE6855-48S6Q-HI",
    connection: { host: "10.0.0.2", user: "operator" },
    users: { operator: { role: "admin", password: secret("SW1_PASSWORD") } },
    management: { allow: ["10.0.0.0/24"], ssh: {} },
    vlans: { mgmt: { id: 99 }, servers: { id: 100 } },
    ports: {
        "10g-1": { description: "server-1", access_vlan: "servers" },
        "40g-1": { description: "uplink", trunk_vlans: ["mgmt", "servers"] },
    },
    interfaces: { mgmt: { type: "vlan", vlan: "mgmt", addresses: ["10.0.0.2/24"] } },
    routing: { static: [{ prefix: "0.0.0.0/0", via: "10.0.0.1" }] },
});
```

Ports are named `<speed>-<position>`: `10g-1` is the first 10G cage. The model decides which exist; the adapter knows what the platform calls each one. Everything a device can hold is in `src/schema/`, with a comment on every field.

A network is a list of devices in `circuit.config.ts` at the root of the project, or any file named with `--config <path>`:

```ts
import { defineNetwork } from "@takodotid/circuit";

export default defineNetwork({ devices: [sw1, r1], checks, state: "state" });
```

`checks` are rules of your own design, run by `validate` beside Circuit's. `state` is where device snapshots are kept, committed, so history shows what each device ran. The CLI writes a `README.md` there saying the directory is generated.

Config is plain data. Shared values are ordinary imports, and anything repetitive can be a function; the result is still plain data.

## Commands

| Command                          | What it does                                                             | Touches a device       |
| -------------------------------- | ------------------------------------------------------------------------ | ---------------------- |
| `validate`                       | Checks the config and every rule in `checks`                             | no                     |
| `build <device>`                 | Prints the whole configuration the device should run                     | no                     |
| `diff [device...]`               | The plan against the last snapshot                                       | no                     |
| `snapshot [device...]`           | Reads what each device runs into the state directory                     | reads                  |
| `apply <device>`                 | Reads the device live and prints the plan; `--confirm` sends it          | yes, with `--confirm`  |
| `refresh <device>`               | Fills prefix sets fetched from a registry; `--confirm` sends             | yes, with `--confirm`  |
| `wireguard <device> <if> <peer>` | A client config for one peer, its private key left for the peer to fill  | no                     |
| `communities`                    | The network's BGP communities, for a looking glass or bgp.tools          | no                     |
| `peeringdb`                      | Brings PeeringDB's exchange records in line with the config; `--confirm` | PeeringDB, `--confirm` |

`apply` also takes `--secrets`, to send every secret when rotating one, and `--rollback=N`, the minutes before a device that can restore itself does, 10 by default. Secrets cannot be read back, so without `--secrets` they are sent only when the object holding them is new.

A change goes:

1. Edit the device's file.
2. `validate`, then `diff <device>` to see the change against the last snapshot.
3. `apply <device>` and read every line of the plan. A `~ set` on a settings menu may turn something off.
4. `apply <device> --confirm`.
5. Commit the config with the snapshot `apply` wrote.

## Publishing the network

Some of the config describes the network to others rather than configuring a device. Devices ignore it.

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

```ts
export default defineNetwork({
    devices,
    state: "state",
    asn: 64500,
    communities: [{ community: "64500:0:nnn", description: "Do not announce to AS$0" }],
    peeringdb: { api_key: secret("PEERINGDB_API_KEY") },
});
```

`peeringdb` compares every interface with a `peeringdb_ixlan` against PeeringDB's records for `asn`: speed, the interface's globally reachable addresses, and whether a BGP neighbor on it is a route server. A record PeeringDB holds that the config does not is reported, never deleted.

`communities` prints one per line, `community,description`, in the format the NLNOG Ring looking glass defines and bgp.tools reads: `nnn` is any number, `x` one digit, `a-b` a range, and `$0`, `$1` in the description are what each wildcard matched.

## How a device is converged

Each adapter guards the apply its platform allows:

| Platform       | Commit                     | If it goes wrong                                                          |
| -------------- | -------------------------- | ------------------------------------------------------------------------- |
| `routeros`     | each command as sent       | backup saved, a scheduler restores it unless a fresh login disarms it     |
| `vrp`          | `commit`, then `save`      | nothing applies until commit; save only after a fresh login proves access |
| `raisecom-ros` | each command, then `write` | write only after a fresh login proves access                              |

Plans run in two phases: additions and changes in dependency order, then removals in reverse, so nothing is removed while something still uses it. An ordered list such as a firewall chain is replaced whole, the old rules deciding until the new ones are in place.

## Platforms

`src/adapters/devices/<platform>/` holds the model catalog, the renderer, the reader and the apply. `TRAPS.md` beside each lists the platform behaviour it works around.

Not every platform can express every field. What one cannot is reported by `validate`, never skipped:

| Feature                                   | routeros              | vrp                   | raisecom-ros            |
| ----------------------------------------- | --------------------- | --------------------- | ----------------------- |
| VLANs, access and trunk ports, links      | yes                   | yes                   | yes                     |
| Per-port STP, storm control, LLDP         | yes, storm in percent | yes, storm in percent | off only, broadcast pps |
| LAGs                                      | yes                   | yes                   | yes                     |
| Routed ports, loopbacks, tunnels          | yes                   | VLAN interfaces only  | VLAN interfaces only    |
| VRRP, VRFs, DHCP relay                    | yes                   | IPv4                  | VRRP, IPv4              |
| Static routes                             | yes                   | yes                   | IPv4 next hop           |
| OSPF and BFD                              | yes                   | IPv4                  | OSPF, IPv4              |
| BGP, policies, prefix sets, RPKI          | yes                   | no                    | no                      |
| Firewall, NAT, hardware ACLs, DHCP server | yes                   | no                    | no                      |
| Flow export                               | NetFlow 9, IPFIX      | sFlow                 | no                      |
| SNMP                                      | v2c, v3 with SHA1     | v2c, v3               | v2c, v3 with SHA1       |
| Certificates, web and API                 | yes                   | no                    | no                      |

`examples/` holds a device per platform using every field its adapter supports. `bun run test` validates them and checks each plans nothing against its own render. Their commands were compiled on real devices without being run.

## Versions

An adapter renders for one major version of its platform and refuses another when it connects. `routeros` is RouterOS 7; RouterOS 6 has a different BGP and filter language and would be an adapter of its own. Within a major version, a property the device does not know is caught before anything is sent: RouterOS compiles every command first, and VRP stages them in a candidate that is cleared on the first refusal. A behaviour that differs between minor versions belongs in the adapter, with a note in its `TRAPS.md`.

Circuit follows semantic versioning. A release is a git tag, `v<major>.<minor>.<patch>`.

## Developing Circuit beside a network

Link the working copy into the network's project, so a change here is live there without a release:

```bash
cd circuit && bun link
cd ../my-network && bun link @takodotid/circuit
```

`bun install` in the network's project returns it to the pinned release.

## Adding a platform

1. `src/adapters/devices/<platform>/models.ts`: each model's ports per speed class and the platform's spelling.
2. An adapter implementing `DeviceAdapter` in `src/adapters/devices/types.ts`. `lines.ts` converges block-structured configurations; `routeros/` shows a command-structured one.
3. Register it in `src/adapters/devices/index.ts` and the catalog in `src/adapters/devices/catalog.ts`.
4. `unsupported()` lists every field it cannot express. Silence is not an option.
5. An example in `examples/` using every field it supports.

## Documentation site

`docs/` is the site at [circuit.tako.id](https://circuit.tako.id), built with VitePress: `bun run docs:dev` serves it locally. It is not part of the package.

## Releases

```bash
bun run release patch | minor | major
bun run release rc [patch | minor | major]
bun run release stable
```

The script commits the version and pushes a tag; the tag publishes the package and a GitHub release.

## License

[Business Source License 1.1](LICENSE). Free in production for an organization whose yearly revenue and funding, with its affiliates, are each under US$100,000; above that, production use needs a commercial license: [legal@tako.id](mailto:legal@tako.id). Each version becomes Apache License 2.0 four years after it is published.

Maintained by the Tako Network Engineering Team. Copyright 2026 PT Hobimu Jadi Cuan.
