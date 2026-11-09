---
description: Tag your routes and take requests from customers with BGP large communities, written once for the whole network.
---

# BGP communities

Communities are little labels on a route. Circuit uses BGP large communities, `asn:code:value` (RFC 8092), the way RFC 8195 describes:

- **Tags** say where a route came from: "learned from a transit", "learned in Frankfurt".
- **Requests** come from your customers: "don't send my route to Cogent", "prepend twice", "blackhole this".

You write it in three places. Circuit writes all the matching and rewriting on each device.

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

That scheme gives you these communities:

| Community        | Kind    | Means                                   |
| ---------------- | ------- | --------------------------------------- |
| `64500:1:1`      | tag     | learned from a transit                  |
| `64500:1:2`      | tag     | learned at an exchange                  |
| `64500:2:1`      | tag     | learned at site 1, `fra-1`              |
| `64500:3:6939`   | tag     | learned from AS6939, Hurricane Electric |
| `64500:100:174`  | request | don't send this to AS174, Cogent        |
| `64500:100:0`    | request | don't send this to anyone               |
| `64500:101:1`    | request | don't send this to any transit          |
| `64500:202:6939` | request | prepend twice toward AS6939             |
| `64500:666:0`    | request | blackhole this                          |

Only write the options you want. A group's `value` and a site's `number` fill the last part.

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
    "de-cix-rs-v4": {
        address: "192.0.2.1",
        remote_as: 6695,
        role: "rs",
        import_policy: "exchange-import",
        export_policy: "export",
        communities: { groups: ["exchange"] },
    },
},
```

`blackhole` is the neighbor's own blackhole community. Leave it out if that neighbor takes no blackholes.

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

These samples are from a project that passes `circuit validate`.

## What the rules do

**`{ communities: "import" }`**

- Takes off every request and every tag of yours the neighbor sent. Want to let some requests through? List them in `accept_requests`.
- Adds your tags: the neighbor's groups, the device's site, the neighbor's AS.
- `add_tags: false` keeps routes as they came. Use it for iBGP.

**`{ communities: "export" }`**

- Blackholed route: sent with the neighbor's `blackhole` community, or dropped if it has none.
- "Don't send to" this AS, its group, or anyone: dropped.
- Prepend requests: prepended.
- Then your own communities come off. `keep_ours: true` keeps them; `send_tags: true` keeps just the tags.

Toward iBGP, write `keep_ours: true`. Circuit stops you if you forget.

## One policy, many neighbors

Requests about one AS need rules for that AS. So when several ASes share a policy, Circuit splits it:

- the shared part stays in your policy;
- each AS gets `<policy>-as<asn>`, such as `export-as6939`, with its own rules, which then calls the shared one.

You don't write those. You see them in `circuit diff`.

## Show them to others

Your scheme also lists every community with what it means, for a looking glass or bgp.tools. Add your own wording with `custom_descriptions`.

`circuit communities` prints the list: NLNOG's `community,description` lines by default, or `--format alice` or `--format json`. See [the command](/guide/cli#communities).
