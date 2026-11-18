---
description: Tag your routes and take requests from customers with BGP large communities, written once for the whole network.
---

# BGP communities

Communities are labels on a route. Circuit uses BGP large communities, `asn:code:value` (RFC 8092), as RFC 8195 describes:

- **Tags** say where a route came from, such as "learned from a transit" or "learned in Frankfurt".
- **Requests** come from your customers, such as "don't send this route to Cogent", "prepend twice", or "blackhole this".

You write them in three places, and Circuit writes the matching and rewriting on each device.

## 1. The scheme, once, in `circuit.ts`

```ts
// circuit.ts
export const as64500 = circuit({
    asn: 64500,
    sites: {
        "fra-1": { number: 1, description: "Frankfurt, Equinix FR5" },
    },
    communities: {
        groups: {
            transit: { value: 1, description: "IP transit" },
            exchange: { value: 2, description: "Internet exchange" },
        },
        learned_from_group: { code: 1 },
        learned_at_site: { code: 2 },
        learned_from_as: { code: 3 },
        do_not_announce_to_as: { code: 100 },
        do_not_announce_to_group: { code: 101 },
        prepend: {
            once: { code: 201 },
            twice: { code: 202 },
            three_times: { code: 203 },
        },
        blackhole: { code: 666 },
    },
});
```

This scheme gives you communities such as these:

| Community        | Kind    | Means                                   |
| ---------------- | ------- | --------------------------------------- |
| `64500:1:1`      | tag     | learned from a transit                  |
| `64500:2:1`      | tag     | learned at site 1, `fra-1`              |
| `64500:3:6939`   | tag     | learned from AS6939, Hurricane Electric |
| `64500:100:174`  | request | don't send this to AS174, Cogent        |
| `64500:100:0`    | request | don't send this to anyone               |
| `64500:101:1`    | request | don't send this to any transit          |
| `64500:202:6939` | request | prepend twice toward AS6939             |
| `64500:666:0`    | request | blackhole this                          |

Write only the options you want. A group's `value` and a site's `number` become the last number of the community.

## 2. Each neighbor says which group it's in

```ts
// sites/fra-1/edge-01.ts, in routing.bgp
neighbors: {
    "hurricane-electric": {
        address: "203.0.113.1",
        remote_as: 6939,
        role: "provider",
        import_policy: "transit-import",
        export_policy: "export",
        // HE takes blackholes on its own community.
        communities: { groups: ["transit"], blackhole: "6939:666" },
    },
},
```

`blackhole` is the neighbor's own blackhole community. Leave it out if the neighbor takes no blackholes.

## 3. Each policy says where the rules go

```ts
// sites/fra-1/edge-01.ts, in routing
policies: {
    sanity: presets.bgp_sanity,
    "transit-import": [
        { call: "sanity" },
        { if: { prefix_set: "ours" }, then: "reject" },
        { communities: "import" },
        { set: { local_pref: 100 }, then: "accept" },
    ],
    export: [
        { communities: "export" },
        { description: "Our own space", if: { prefix_set: "ours" }, then: "accept" },
        { description: "Nothing else leaves", then: "reject" },
    ],
},
```

## What the rules do

`{ communities: "import" }`:

- Removes every request and every tag of yours that the neighbor sent. `accept_requests` lets some requests through.
- Adds your tags: the neighbor's groups, the device's site, and the neighbor's AS.
- With `add_tags: false`, routes keep the tags they came with, and Circuit adds none. Use it for iBGP.

`{ communities: "export" }`:

- Sends routes that ask for a blackhole with the neighbor's `blackhole` community. If the neighbor has none, the routes are dropped.
- Drops the routes that ask not to go to this AS, to its group, or to anyone.
- Prepends the routes that ask for it.
- Removes your own communities. `keep_ours: true` keeps them all, and `send_tags: true` keeps only the tags.

Toward iBGP, `keep_ours` is required. Write `true` to keep your communities on routes inside your network.

## One policy, many neighbors

A request about one AS needs rules for that AS. So when neighbors in several ASes share a policy, Circuit splits it:

- The shared rules stay in your policy.
- Each AS gets its own policy, `<policy>-as<asn>`, such as `export-as6939`. It holds the rules for that AS, then calls the shared policy.

You don't write these policies, but you see them in `circuit diff`.

## Publish your communities

Circuit can list every community of your scheme with what it means. Looking glasses and bgp.tools read this list. `circuit communities` prints it in [several formats](/reference/cli#communities). To change the wording, add `custom_descriptions` to the scheme.
