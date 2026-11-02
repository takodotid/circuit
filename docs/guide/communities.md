# BGP communities

A network's BGP large communities, `asn:code:value` (RFC 8092), used as RFC 8195 describes. You write them in three places, and Circuit writes the rest.

1. **The scheme, once**, in `circuit({ communities })`. Each option is an object with its `code`, and may have its own `description`. `asn` is the network's when absent.
2. **Each neighbor or neighbor group** says which `groups` it is in, and its own `blackhole` community when it takes blackholes from us: `communities: { groups: ["transit"], blackhole: "64501:666" }`.
3. **Each policy** places `{ communities: "import" }` or `{ communities: "export" }` where those rules go.

| Option                     | Community                                             | Is                                  |
| -------------------------- | ----------------------------------------------------- | ----------------------------------- |
| `groups`                   | `{ value, description? }` each                        | the groups the `_group` options use |
| `learned_from_group`       | `asn:code:<group value>`                              | a tag                               |
| `learned_at_site`          | `asn:code:<site number>`                              | a tag, from the site's `number`     |
| `learned_from_as`          | `asn:code:<asn>`                                      | a tag, never on a customer's routes |
| `do_not_announce_to_as`    | `asn:code:<asn>`, `asn:code:0` for anyone             | a request                           |
| `do_not_announce_to_group` | `asn:code:<group value>`                              | a request                           |
| `prepend`                  | `once`, `twice`, `three_times`, each `asn:code:<asn>` | a request                           |
| `blackhole`                | `asn:code:0`                                          | a request                           |
| `custom_descriptions`      | your own words for one community                      | for the catalogue                   |

An import rule takes off every request (unless `accept_requests` lists it) and every tag of ours, then adds each tag the scheme has: the neighbor's groups, the device's site, the neighbor's AS. `add_tags: false` leaves the tags as they came, for iBGP.

An export rule rejects a blackholed route, or passes it on with the neighbor's `blackhole` community; rejects a route asked not to go to anyone, to this AS or to its groups; prepends where asked; then takes our communities off. `keep_ours: true` keeps them, and `send_tags: true` keeps the tags. Toward iBGP, write `keep_ours`: Circuit stops without it. Toward a customer, there is no request about one AS.

A policy one AS uses gets the rules in its place. A policy several ASes use keeps what they share, and each AS with rules of its own gets a policy `<policy>-as<asn>` that holds them and then calls the shared one.
