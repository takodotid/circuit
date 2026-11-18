---
title: Imports filter, then decide
description: Every BGP import rejects the routes no neighbor should send, such as special-purpose blocks, bogon AS numbers, prefixes too long or too short, RPKI invalid routes, and your own space, then ends in an accept or a reject.
---

# Imports filter, then decide

Every BGP import first rejects the routes no neighbor should send you, then ends in a rule that accepts or rejects every route left.

## Why

A neighbor sends whatever its own filters let out, mistakes included. Five kinds of route are never right from outside:

- **Special-purpose blocks**, such as the private ranges, which IANA keeps off the internet.
- **Prefixes too long or too short**: longer than /24 or /48 is too specific for the global table. Shorter than /8 or /16 is wider than any one network holds.
- **Bogon AS numbers and long paths**: a route with a private or reserved AS in its path, or with over 100 ASes in it, is a leak or a mistake.
- **RPKI invalid routes**: the holder of the prefix published a ROA, and the route contradicts it.
- **Your own space, coming back**: you know where it is, so anyone else announcing it is a mistake or a hijack.

On February 24, 2008, another network announced a /24 inside YouTube's /22, and much of the internet sent YouTube's traffic there for about two hours. A ROA for YouTube's /22 now makes such a route RPKI invalid, and an import that rejects invalid routes drops it.

The last rule decides for every route that is left. An import that ends in a `set` with no `then` accepts nothing, because Circuit rejects a route that no rule accepts.

## In Circuit

- `presets.bgp_sanity` rejects the lengths and the RPKI invalid routes. Your validators go in `routing.rpki`.
- `presets.bogons` lists the special-purpose blocks of each family, for a prefix set.
- `presets.bogon_asns` lists the AS numbers no route should carry, for `as_path_contains`. `as_path_length` caps the path.
- A prefix set of your own space rejects it on the way in.
- `imports_end_in_accept_or_reject: true` in `circuit.ts` stops an import that doesn't end in an accept or a reject with no `if`.

Here is the transit import of the [edge router example](/guide/examples#an-edge-router):

<<< @/../examples/edge-router/sites/pop-1/edge-01.ts#imports

A neighbor without an `import_policy` accepts nothing. [Route policies](/academy/intermediate/route-policy) runs routes through an import one by one, [Hijacks and leaks](/academy/professional/routing-security) explains RPKI, and [Standards](/reference/standards#routing) gives the RFC behind each preset.

## Further reading

- [RFC 7454 (BCP 194)](https://www.rfc-editor.org/rfc/rfc7454), sections 6.1.1 to 6.1.4: which prefixes to filter.
- [RFC 6811](https://www.rfc-editor.org/rfc/rfc6811): route origin validation.
- [NLNOG BGP Filter Guide](https://bgpfilterguide.nlnog.net/): bogon AS numbers and long AS paths.
- [A case study of the 2008 hijack, by the RIPE NCC](https://www.ripe.net/about-us/news/youtube-hijacking-a-ripe-ncc-ris-case-study/).
