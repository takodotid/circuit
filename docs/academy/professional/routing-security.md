---
title: Hijacks and leaks
description: Tell a hijack from a route leak with two real incidents, then stop both with ROAs, route origin validation, registry filters, and MANRS.
---

# Hijacks and leaks

A **hijack** is a route announced by a network that doesn't hold the addresses. Traffic for them goes to that network instead of to their holder.

A **route leak** is a real route passed on to networks that should never have received it. Traffic still reaches the holder, but the long way, through a network that can't carry it.

BGP believes what neighbors tell it, so BGP itself stops neither. Three things stop them:

- Signed records of who may originate your space, which others check with route origin validation.
- Filters built from what each customer registered.
- A set of norms, MANRS, that asks every network to do both.

## Two incidents

**A hijack, on February 24, 2008.** At 18:47 UTC, Pakistan Telecom, AS17557, began announcing `208.65.153.0/24`. YouTube, AS36561, announced `208.65.152.0/22`, which includes that /24. The upstream of Pakistan Telecom, PCCW Global, AS3491, passed the /24 on. A /24 is a longer match than a /22, so routers that heard it sent YouTube's traffic for those addresses to Pakistan.

At 20:07 YouTube announced the same /24. This won back only part of the internet, because two routes of equal length compete on path. At 20:18 YouTube announced two /25 routes inside it, longer than anything else, and traffic came back. At 21:01 PCCW withdrew the routes.

**A leak, on June 24, 2019.** At 10:30 UTC, DQE Communications, AS33154, was running a <Term means="Software that splits a network's routes into smaller, more specific ones to steer its own traffic. The more specific routes are meant to stay inside that network.">BGP optimizer</Term>. It had split routes it learned into more specific ones, for use inside its own network. They reached its customer Allegheny Technologies, AS396531. Allegheny passed them to its other provider, Verizon, AS701, which passed them on to the internet.

The routes were more specific, so much of the internet sent traffic for the affected networks through DQE, Allegheny, and Verizon, which weren't built for it. Cloudflare saw about 15% of its global traffic lost at the worst point. Many sites couldn't be reached from large parts of the internet. Cloudflare's ROAs allowed nothing longer than /20, so the more specific routes made from its space were RPKI invalid. A network that dropped invalid routes would have refused them.

|                    | Hijack                                             | Route leak                                              |
| ------------------ | -------------------------------------------------- | ------------------------------------------------------- |
| The route          | Announced by a network that doesn't hold the space | A real route, passed on beyond where it was meant to go |
| The origin AS      | Wrong, or forged to look right                     | Right                                                   |
| Where traffic goes | To the hijacker                                    | To the holder, through the leaking network              |
| What stops it      | Origin validation, registry filters                | Registry filters, roles, `max_prefixes`                 |

<Quiz
  question="A network learns your prefix from its provider, and announces it to its other provider. The AS path still ends in your AS. Which is it?"
  :choices="['A hijack', 'A route leak', 'Neither, since the origin is right']"
  :answer="1"
  :why="['A hijacker announces space that is not its own, so the origin is wrong or forged. Here it only passed your real route on.', '', 'The origin is right, but the route went where it should not: from one provider to another. That is the definition of a leak.']"
  explain="The route is real and still ends in your AS, but it was passed from one provider to another, beyond its intended scope. RFC 7908 calls that a route leak."
/>

## Route origin validation

You met RPKI, the Resource Public Key Infrastructure, and its three answers in [Route policies](/academy/intermediate/route-policy). Here is where they come from:

1. **You publish a ROA.** A <Term means="Route Origin Authorization: a signed record that says which AS may announce a prefix, and how specific the prefixes it announces inside it may be, such as up to /24.">ROA</Term> says that this prefix, up to this length, may be originated by this AS. You create it with your <Term means="Regional internet registry: one of five organizations that hand out addresses and AS numbers for a part of the world. APNIC is the one for Asia and the Pacific.">RIR</Term>, the registry that gave you the space. At APNIC, you do it in the MyAPNIC portal.
2. **Validators collect them.** A <Term means="A program that downloads every ROA from the registries, checks each signature, and gives routers the list of valid ones.">validator</Term> downloads every ROA and checks its signature. It serves the result to routers over the RPKI to Router protocol, RTR. Routinator is one such program.
3. **Routers check every route.** For each route, the router compares the prefix and the <Term means="The AS that first announced a prefix: the network the addresses belong to. It is the last AS in the AS path.">origin AS</Term> with the ROAs. It marks the route valid, invalid, or not found.
4. **Your policy acts on it.** `presets.bgp_sanity` rejects invalid routes. Valid and not found ones go on through the rest of the import.

RFC 6811 defines the check with two words. A ROA **covers** a route when the route's prefix is the prefix of the ROA, or inside it. A ROA **matches** a route when it covers it, has the same origin AS, and allows its length. Then:

- **Not found** means no ROA covers the route.
- **Valid** means at least one ROA matches it.
- **Invalid** means at least one ROA covers it, and none matches.

<TryIt title="Decide valid, invalid, or not found">

Load each case and read which ROAs cover the route, and which match. Then change a `maxLength` or the origin yourself, and predict the answer before you look.

<OriginCheck />

</TryIt>

Two things are easy to miss:

- **A route can be invalid for its length alone.** The "A /48 of yours" case comes from your own AS. But your ROA allows only a /40, so the /48 is invalid.
- **`maxLength` is a promise to everyone.** A ROA that allows every /48 inside your /40 makes any of them valid from your AS, even ones you never announce. A hijacker who writes your AS at the end of the path then passes the check. This is a **forged origin**, as in the "Forged origin" case.

So RFC 9319 asks for minimal ROAs. List the prefixes you really announce, and avoid `maxLength`.

<Quiz
  question="Your ROA is 2001:db8:a00::/40, maxLength 40, AS64500. A route for 2001:db8:a00::/44 arrives from AS64500. What is it?"
  :choices="['Valid, since the origin is right', 'Invalid, since it is longer than the ROA allows', 'Not found, since no ROA is for a /44']"
  :answer="1"
  :why="['The origin matches, but a match also needs the length to be within maxLength, and /44 is longer than /40.', '', 'A ROA covers every prefix inside its own, so the /40 covers the /44. Not found is only for routes no ROA covers.']"
  explain="The /40 ROA covers the /44 and has AS64500 as the origin, but allows nothing longer than /40. A covering ROA with no match makes the route invalid."
/>

## Watching a hijack die out

Here your network, AS64500, has `2001:db8:a00::/40`. AS64510 is another customer of your provider, and also of the east transit. In the widget, each network prefers routes from its customers, then from its peers, then from its providers, then the shorter path. On a tie, it takes the route from the lower AS number.

<TryIt title="Hijack your block, then stop it">

AS64510 starts by announcing your /40. See which networks now send your traffic to it. Then publish a ROA, and turn on origin validation network by network until every network reaches you. Then try the other things AS64510 can do, and the registry filters.

<HijackSpread />

</TryIt>

What you saw is how the internet behaves:

- **An equal hijack wins part of the internet**, the networks closer to the hijacker by preference or path. A more specific hijack wins all of it, because the longest match beats every preference, as it did for YouTube.
- **Without your ROA, nothing is invalid.** Every network can validate, and your route is still not found. Your ROA is what makes other networks' validation protect you.
- **Validation at one network isn't enough.** Against the /48, with only the east transit validating, the east transit refused the route. But its traffic still went to the west transit, which had accepted the /48, and so ended at AS64510. Against the /40, with only the east ISP validating, it dropped the one route the east transit offered. It was left with no route at all.
- **A forged origin beats validation when `maxLength` allows the length.** With `max /40`, the forged /48 was invalid by length. With `max /48`, it was valid.
- **A leak of your real route beats validation.** The route keeps your origin and your length, so it is valid. Only a filter on what AS64510 may send stops it. The 2019 leak was different in one way: the optimizer had made new, more specific routes, which tight ROAs make invalid.

<Quiz
  question="AS64510 leaks your route to the east transit. Every network drops RPKI invalid routes, and your ROA is right. Why does the leak still spread?"
  :choices="['Because the ROA has the wrong maxLength', 'Because the leaked route is your real route, with your AS as the origin, so it is valid', 'Because the east transit does not support RPKI']"
  :answer="1"
  :why="['The leak announces your /40 exactly, which a maxLength of 40 allows. maxLength cannot help with a leak.', '', 'In the widget, the east transit validates. Validation checks only the origin and the length, and both are right.']"
  explain="Origin validation asks one question: may this AS originate this prefix at this length? A leak keeps your origin, so the answer is yes. Stopping a leak needs a filter on what each neighbor may send, or roles."
/>

## Registry filters

An <Term means="Internet Routing Registry: databases where networks publish which AS announces each prefix, in route objects, and which ASes they announce, in AS-SETs.">IRR</Term> has two kinds of record that matter here:

- A <Term means="An IRR record that pairs a prefix with the AS that announces it.">route object</Term> pairs a prefix with its origin AS.
- An <Term means="A named list of AS numbers in an IRR, such as a network and its customers, AS64500:AS-CUSTOMERS.">AS-SET</Term> lists the ASes a network announces: the network itself and its customers.

A provider builds each customer's import filter from them. A tool such as bgpq4 expands the customer's AS-SET into every route object behind it, and the filter accepts only those prefixes. A leak or a hijack from a filtered customer then stops at the first provider. That is why you register your customers before you announce them: your upstreams filter you the same way.

Two more guards stop leaks, both from [Route policies](/academy/intermediate/route-policy):

- `role` on each neighbor turns on RFC 9234, so both sides refuse a route that should only flow toward customers. Of the platforms with BGP, only `routeros` has roles.
- `max_prefixes` closes a session that suddenly sends far more routes than it should, as in 2019.

## In Circuit

The validators go in `routing.rpki`, and `presets.bgp_sanity` rejects what they mark invalid. A customer's import accepts only its registered space, written in `prefix_sets`:

```ts
routing: {
    rpki: [
        { address: "10.0.0.80", port: 323 },
        { address: "10.0.0.81", port: 8282 },
    ],
    // bgp: as before, with role and max_prefixes on every neighbor
    prefix_sets: {
        // Netflix's space, checked against its route objects and ROAs before it is written here.
        "netflix-v4": { prefixes: ["192.0.2.0/24"] },
        "netflix-v6": { prefixes: ["2001:db8:200::/48"] },
    },
    policies: {
        sanity: presets.bgp_sanity,
        "netflix-import": [
            { call: "sanity" },
            { description: "Their IPv4", if: { prefix_set: "netflix-v4" }, then: "accept" },
            { description: "Their IPv6", if: { prefix_set: "netflix-v6" }, then: "accept" },
            { description: "Nothing else", then: "reject" },
        ],
    },
},
```

Run two validators, so a router still has answers while one is down. A rule of your own can also match `rpki: "valid"`, `"invalid"`, or `"not-found"`.

Circuit doesn't do three things:

- **It doesn't publish your ROAs.** You create them at your RIR.
- **It doesn't read the IRR.** You check each customer's route objects and ROAs, then write its prefixes yourself.
- **It runs RPKI on `routeros` and `junos` only.** `fortios` runs BGP without RPKI. So it refuses `routing.rpki` and any rule that matches `rpki`, including the last rule of `presets.bgp_sanity`. [Platforms](/reference/platforms) has the details.

## Norms for routing security

<Term means="Mutually Agreed Norms for Routing Security: a global initiative that asks networks to take a short list of actions against hijacks, leaks, and spoofing.">MANRS</Term>, Mutually Agreed Norms for Routing Security, is a global initiative supported by the Global Cyber Alliance. It asks network operators for four actions:

1. **Filtering.** Make sure your own announcements and your customers' are correct, with registry filters.
2. **Anti-spoofing.** Check the source address of your customers' traffic, as in [Attacks on the network](/academy/professional/ddos-and-spoofing).
3. **Coordination.** Keep your contact details in the routing databases current, so another network can reach you during an incident.
4. **Global information.** Publish your routing data, in the IRR and as ROAs, so others can validate it.

A network that joins commits to all four, and this lesson or the next shows you how to do each.

## Further reading

- [YouTube Hijacking: A RIPE NCC RIS case study](https://www.ripe.net/publications/news/industry-developments/youtube-hijacking-a-ripe-ncc-ris-case-study), on the 2008 hijack, minute by minute.
- [How Verizon and a BGP Optimizer Knocked Large Parts of the Internet Offline Today](https://blog.cloudflare.com/how-verizon-and-a-bgp-optimizer-knocked-large-parts-of-the-internet-offline-today/), the Cloudflare write-up of the 2019 leak.
- [RFC 7908](https://www.rfc-editor.org/rfc/rfc7908), on the kinds of BGP route leaks.
- [RFC 6811](https://www.rfc-editor.org/rfc/rfc6811), BGP prefix origin validation: covered, matched, and the three states.
- [RFC 9319](https://www.rfc-editor.org/rfc/rfc9319), on `maxLength` in the RPKI: minimal ROAs and forged origins.
- [RFC 9582](https://www.rfc-editor.org/rfc/rfc9582), the profile for route origin authorizations.
- [RFC 9234](https://www.rfc-editor.org/rfc/rfc9234), on preventing route leaks with roles.
- [APNIC RPKI](https://www.apnic.net/community/security/resource-certification/), on creating ROAs in MyAPNIC.
- [Routinator](https://www.nlnetlabs.nl/projects/routing/routinator/), a validator.
- [bgpq4](https://github.com/bgp/bgpq4), which builds prefix filters from the IRR.
- [RIPEstat announced-prefixes](https://stat.ripe.net/docs/data-api/api-endpoints/announced-prefixes), the data behind `ripe-stat` prefix sets.
- [MANRS for network operators](https://manrs.org/netops/) and its [implementation guide](https://manrs.org/netops/guide/).

## In short

- A hijack announces space that isn't the announcer's. A leak passes a real route beyond where it should go. Both pull traffic the wrong way, and BGP alone stops neither.
- Publish minimal ROAs at your RIR. Route origin validation marks a route valid when a ROA matches its origin and length, invalid when ROAs cover it but none matches, and not found otherwise.
- Validation protects you only where others drop invalid routes on the way. It never stops a leak, or a forged origin within `maxLength`.
- Registry filters on every customer, `role`, and `max_prefixes` stop leaks and hijacks at the first provider.
- In Circuit, put the validators in `routing.rpki`, `presets.bgp_sanity` first in every import, and each customer's registered space in `prefix_sets`. MANRS asks every network for these, plus anti-spoofing and current contacts.
