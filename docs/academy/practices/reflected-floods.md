---
title: Drop reflected floods
description: Where traffic enters from the internet, drop UDP from the ports of amplifying services that nobody in your network uses across the internet, with presets.udp_amplifiers.
---

# Drop reflected floods

Where traffic enters from the internet, drop UDP that comes from the ports of amplifying services nobody in your network uses across the internet.

## Why

Some UDP services answer a small request with a much larger reply. An attacker sends them requests with a victim's address as the source, and every reply goes to the victim. So the flood comes from the service's own port.

On February 28, 2018, GitHub received a flood of replies from `memcached` servers, on UDP port 11211, that peaked at 1.35 terabits a second. Each request to `memcached` can bring back up to 51,000 times its size.

Nobody in your network asks a `memcached` server across the internet, so a reply from port 11211 is always part of a flood. Dropping it where it enters keeps it off your router and your customers. It can't free the link it arrived on. Only an upstream can, with a [blackhole](/academy/professional/ddos-and-spoofing#shedding-a-flood) route for the target.

## In Circuit

`presets.udp_amplifiers` gives the port of each of these services by name, from the CISA alert TA14-017A plus six more. Pick only the ones nobody in your network uses across the internet. Leave out `dns` and `ntp`, because your resolvers and clocks get real replies from those ports.

This rule, added to the `edge` ACL of the [edge router example](/guide/examples#an-edge-router), drops four of them in the switch chip:

```ts
{
    description: "Reflected floods",
    if: {
        vlan: ["transit", "exchange"],
        protocol: "udp",
        src_port: [presets.udp_amplifiers.qotd, presets.udp_amplifiers.chargen, presets.udp_amplifiers.ssdp, presets.udp_amplifiers.memcached],
    },
    then: "drop",
},
```

[Attacks on the network](/academy/professional/ddos-and-spoofing) explains reflection, and [Standards](/reference/standards#firewall) gives the source of each preset.

## Further reading

- [GitHub's report on the February 2018 attack](https://github.blog/news-insights/company-news/ddos-incident-report/).
- [CISA, UDP-Based Amplification Attacks](https://www.cisa.gov/news-events/alerts/2014/01/17/udp-based-amplification-attacks).
