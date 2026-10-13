---
title: Watching the network
description: Turn SNMP counters into traffic, see who sends what with flow records, and set alerts that wake someone only when it matters. Work it out, then find an incident.
---

# Watching the network

You watch a network in three ways. **Counters** on every port say how much traffic passes, and a monitoring server reads them every few minutes and draws graphs. **Flow records** say who sent that traffic to whom. **Logs** say what each device noticed about itself. On top of all three, **alerts** turn what is measured into a message to a person, but only when that person has something to do.

Circuit does not watch anything itself. It writes the part of each device's config that lets the tools watch it, and it hands those tools the list of devices, so a device you add is watched without anyone typing it in twice.

## Counters: how much

Every router and switch keeps counters for each port: bytes in, bytes out, packets, errors. A monitoring server reads them with <Term means="Simple Network Management Protocol: how a monitoring server asks a device for its counters and settings. The device answers; the server keeps the history.">SNMP</Term>. The device runs a small SNMP <Term means="The part of a device that answers SNMP questions about it.">agent</Term>, and the monitoring server, the manager, asks it for named values from a <Term means="Management Information Base: the catalogue of everything a device can be asked over SNMP, each value with its own name and number.">MIB</Term>. Asking again and again on a timer is called <Term means="Asking a device for a value at a fixed interval, such as every five minutes.">polling</Term>.

The value for traffic is a port's byte counter, `ifInOctets` for bytes received. It only ever goes up, so one reading says nothing: the counter has counted since the device started, and the standard itself says a single value has no meaning. Two readings do. The traffic between them is:

1. The second reading minus the first: the bytes that passed.
2. Times 8: the bits.
3. Divided by the seconds between the two readings: bits per second.

<TryIt title="Work out the traffic from two polls">

Work out the traffic from the two readings and check your answer. Then make the port busier, poll less often, and switch between the two counters.

<CounterRate />

</TryIt>

The 32-bit counter, `ifInOctets`, counts up to 4,294,967,295 and then starts again from 0. When the second reading is smaller than the first, the counter has gone round, and if it went round only once, adding 4,294,967,296 puts it right. But at 400 Mbit/s it goes round every 86 seconds, so between polls five minutes apart it goes round four times, and nothing in two readings says so. The graph shows a quiet 56 Mbit/s for a port carrying 400.

That is why the standard for these counters requires 64-bit ones, `ifHCInOctets`, for byte counts on any port faster than 20 Mbit/s. A 64-bit counter would take thousands of years to go round at 900 Mbit/s. They need SNMP version 2c or 3: a device must never send one in answer to a version 1 request.

<Quiz
  question="A graph of a busy 10 Gbit/s port shows a calm 300 Mbit/s all day, read from ifInOctets every five minutes. What is most likely wrong?"
  :choices="['Nothing: the port is just quiet', 'The 32-bit counter goes round many times between polls, and the graph only sees what is left over', 'Polling every five minutes always halves the traffic']"
  :answer="1"
  :why="['A port that busy fills a 32-bit counter in a few seconds. The graph cannot be trusted until it reads ifHCInOctets.', '', 'The interval only decides how much detail you see. With the right counter, the average over five minutes is right.']"
  explain="At 10 Gbit/s a 32-bit byte counter goes round about every three and a half seconds. Two polls five minutes apart see only the part of the last lap, so the graph is meaningless. Read ifHCInOctets instead."
/>

## Graphs from the counters

The tool that made this common was <Term means="Multi Router Traffic Grapher: a program from the 1990s that polls traffic counters over SNMP and draws graphs of them on web pages.">MRTG</Term>, the Multi Router Traffic Grapher. It began in 1994 as a quick way to graph a single 64 kbit/s line, was first released in 1995, polls every five minutes by default, and draws a graph for the day, the week, the month and the year.

Today two kinds of tool do the same job with more around it:

- **[LibreNMS](https://www.librenms.org)** monitors devices over SNMP, every five minutes by default: traffic graphs, port status, and alerts when something goes down. `circuit librenms` adds every device in your config that LibreNMS does not monitor yet. See [LibreNMS](/integrations/librenms).
- **[Prometheus](https://prometheus.io)** collects numbers of every kind, once a minute by default, and a tool such as Grafana draws them as graphs. It reads network devices through its SNMP exporter. `circuit prometheus` writes the list of devices it should read. See [Prometheus](/integrations/prometheus).

The interval is the detail you get. A five-minute point is an average: a flood that lasts thirty seconds shows as a small bump, not as the full port it caused.

### In Circuit

SNMP is a service under `management`, like SSH. Give it a version 3 user, which signs and encrypts every message, rather than a version 2c <Term means="The shared password of SNMP versions 1 and 2c, sent with every request in plain text.">community</Term>, which the standard calls insecure. Allow only the monitoring server:

```ts
management: {
    allow: [MANAGEMENT],
    ssh: {},
    snmp: {
        allow: ["10.0.0.20/32"],
        users: {
            monitor: {
                auth: "sha1",
                auth_password: secret("EDGE_01_SNMP_AUTH"),
                privacy: "aes128",
                privacy_password: secret("EDGE_01_SNMP_PRIVACY"),
            },
        },
        location: "Rack A1",
    },
},
```

This is `edge-01` from the [colocation pattern](/patterns/colocation), a RouterOS router. With `auth: "sha256"`, `circuit validate` stops and says why:

```
  error  edge-01: routeros cannot express management.snmp.users.monitor.auth sha256, the platform authenticates with SHA1 or MD5
```

The pattern's VRP switch takes the same user but not its own `allow`: on that platform every service uses `management.allow`, and validate says that too. With SNMP on both devices, `npx circuit prometheus` prints:

```json
[
    {
        "targets": ["10.0.0.1"],
        "labels": {
            "device": "edge-01",
            "platform": "routeros",
            "model": "CCR2216-1G-12XS-2XQ",
            "__param_auth": "edge-01"
        }
    },
    {
        "targets": ["10.0.99.2"],
        "labels": {
            "device": "tor-01",
            "platform": "vrp",
            "model": "CE6855-48S6Q-HI",
            "__param_auth": "tor-01"
        }
    }
]
```

## Flow records: who sends what

A counter says the transit port is full. It does not say who is filling it. For that, the router describes the traffic itself. A <Term means="A run of packets with the same source and destination addresses, ports and protocol, seen passing a device over some time.">flow</Term> is a run of packets that share their addresses, ports and protocol, and a flow record says how many packets and bytes it had. The router sends its records to a <Term means="A server that receives flow records or packet samples from devices, stores them, and answers questions such as who sent the most.">collector</Term>, which can then answer "who sent the most to this address in the last five minutes".

Three formats do this, each described in an <Term means="Request for Comments: the numbered documents in which internet standards and common practice are published.">RFC</Term>:

| Format    | From                                                      | What it sends                                                                                                 |
| --------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| NetFlow 9 | Cisco, published as RFC 3954                              | A record per flow, once the flow ends or has run long enough                                                  |
| IPFIX     | The internet's own standard, RFC 7011, built on NetFlow 9 | The same idea, with a version number one above NetFlow 9's                                                    |
| sFlow     | RFC 3176                                                  | Not flows: one packet in N, picked at random, with its headers copied to the collector, and the port counters |

A busy router cannot afford to look at every packet, so it usually <Term means="Looking at one packet in N, such as one in 1,000, and multiplying what was seen by N to estimate the whole.">samples</Term>: it looks at one packet in N, and the collector multiplies by N. The big flows come out right; a flow of a few packets may never be picked at all. Sampling is for "who is filling the port", not for proving that one packet passed.

### In Circuit

`flow_export` takes the format, the collectors, the sampling rate and the ports to watch. On the edge router, the two ports to the outside:

```ts
// One packet in 1,000 on the two ports to the outside, as IPFIX records to the collector.
flow_export: { protocol: "ipfix", collectors: [{ address: "10.0.0.20" }], sampling: 1000, interfaces: ["25g-1", "25g-2"] },
```

And on the switch:

```ts
flow_export: { protocol: "sflow", collectors: [{ address: "10.0.0.20" }], sampling: 4096 },
```

Circuit writes what each platform's adapter supports: NetFlow and IPFIX on RouterOS, and sFlow on VRP, which samples one packet in 4,096 at most. `circuit validate` says so for any other choice. When you give no port, Circuit sends sFlow to 6343 and the other two to 2055. IPFIX's own standard names 4739, so set `port` to whatever your collector listens on.

## Logs: what the device noticed

Devices also write messages about themselves: a port went down, a BGP session closed, someone failed to log in. They send them to a <Term means="A server that receives log messages from many devices over the network and keeps them in one place.">syslog</Term> server, each with a severity from 0, emergency, to 7, debug. Keep the warnings and worse:

```ts
logging: { remote: [{ address: "10.0.0.20", level: "warning" }] },
```

This goes under `system`, and sends every message from `warning` up, through `error`, `critical`, `alert` and `emergency`, to the server.

## Alert on what matters

A graph is only useful while someone looks at it. An <Term means="A rule that sends a message to a person, by phone, chat or pager, when something measured crosses a line.">alert</Term> watches for you, and a <Term means="An alert urgent enough to interrupt someone, at any hour, who is on call to answer it.">page</Term> is one urgent enough to wake the person on call.

<TryIt title="Find the incident, then set the alert">

Find the moment something went wrong on the transit port, read the flow records at that moment, then pick an alert rule and see how many times it would have woken someone today. The traffic is made up, and the same every time.

<TrafficDay />

</TryIt>

The flood was obvious once you saw it, and the flow records named its target at once: UDP from tens of thousands of addresses to one of acme's servers. [Attacks on the network](/academy/professional/ddos-and-spoofing) is about what to do next.

The alert is where judgement comes in. A line at 8 Gbit/s is crossed every evening by ordinary traffic, and on a wobbly line it is crossed several times, so it pages again and again for nothing. Google's book on running large systems puts the rules plainly: every page must be something a person can act on, and needs a person's thinking to answer. Pages that come too often get skimmed, then ignored, and one day the real one is ignored too.

Good network alerts usually describe what customers feel or are about to feel:

- a port close to full, which is when traffic starts to queue and drop;
- a BGP session to a transit or an exchange gone down;
- a device that stops answering its polls;
- errors climbing on a port.

Everything else, such as a port in a quiet hour or a single failed login, belongs in a report or a dashboard, not on someone's phone at 3 in the morning.

<Quiz
  question="The transit port is full. Which tells you which of your customers the traffic is going to?"
  :choices="['The SNMP counter of the port', 'The flow records from the router', 'The syslog messages from the router']"
  :answer="1"
  :why="['The counter only says how many bytes passed. It knows nothing about addresses.', '', 'Logs say what the device noticed about itself, such as a port going down. They do not describe traffic.']"
  explain="Flow records carry the addresses, ports and protocol of the traffic. The collector can then list the top destinations at the moment the port filled."
/>

<Quiz
  question="An alert pages the on-call engineer every evening when inbound traffic passes 8 Gbit/s. Each time, the engineer looks and does nothing. What should change?"
  :choices="['Nothing: it is better to be woken too often than too rarely', 'Set the line above the ordinary evening peak, and send the evening numbers to a report instead', 'Poll every minute instead of every five']"
  :answer="1"
  :why="['A page nobody acts on teaches people to ignore pages, and the real one is ignored too.', '', 'Polling more often gives more detail, but the evening peak still crosses the line every night.']"
  explain="A page must be something a person can act on. The evening peak is normal, so it belongs in a report; the line for a page belongs where traffic is not normal."
/>

## Further reading

- [RFC 2863, The Interfaces Group MIB](https://www.rfc-editor.org/rfc/rfc2863.html): the port counters, and when 64-bit counters are required.
- [RFC 2578, SMIv2](https://www.rfc-editor.org/rfc/rfc2578.html): how a Counter32 and a Counter64 wrap, and why one reading means nothing.
- [RFC 3410, Introduction to SNMPv3](https://www.rfc-editor.org/rfc/rfc3410.html): agents and managers, the MIB, and why community strings are insecure.
- [RFC 3584, Coexistence between SNMP versions](https://www.rfc-editor.org/rfc/rfc3584.html): why a 64-bit counter is never sent in answer to SNMP version 1.
- [MRTG](https://oss.oetiker.ch/mrtg/doc/mrtg.en.html) and [its reference](https://oss.oetiker.ch/mrtg/doc/mrtg-reference.en.html): the classic traffic grapher, its five-minute interval and its 64-bit counters.
- [LibreNMS: 1 minute polling](https://docs.librenms.org/Support/1-Minute-Polling/): its default of 300 seconds.
- [Prometheus configuration](https://prometheus.io/docs/prometheus/latest/configuration/configuration/): its default scrape interval of one minute.
- [RFC 3954, NetFlow version 9](https://www.rfc-editor.org/rfc/rfc3954.html), [RFC 7011, IPFIX](https://www.rfc-editor.org/rfc/rfc7011.html) and [RFC 3176, sFlow](https://www.rfc-editor.org/rfc/rfc3176.html).
- [RFC 5424, The Syslog Protocol](https://www.rfc-editor.org/rfc/rfc5424.html): the eight severities.
- [Monitoring Distributed Systems](https://sre.google/sre-book/monitoring-distributed-systems/), from Google's Site Reliability Engineering book: what deserves a page.

## In short

- Port counters only go up. Traffic is the difference between two polls, times 8, divided by the seconds between them.
- A 32-bit counter goes round every few seconds or minutes on a fast port; read the 64-bit `ifHCInOctets`.
- MRTG drew the first five-minute graphs; LibreNMS and Prometheus do it today, and Circuit hands them every device with `circuit librenms` and `circuit prometheus`.
- Flow records, from NetFlow, IPFIX or sampled sFlow, say who sent what; `flow_export` turns them on.
- Page a person only for what they must act on; the rest goes in a report.
