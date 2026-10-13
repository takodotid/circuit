---
title: Firewalls
description: A firewall decides which traffic may pass, by rules read from the top. Reorder and change rules, send test packets, and write the rules in Circuit.
---

# Firewalls

A firewall is a list of rules on the router that decides, for each packet, whether it may pass. The router reads the rules from the top, and the first rule that matches the packet decides what happens to it. The rules below are not read. A packet that no rule matches gets the default, which is written at the end.

That is the whole mechanism. Getting it right comes down to three things: the order of the rules, the default, and knowing which list a packet is checked against.

## Rules, read from the top

A rule has two parts. Its match says which packets it is about, and its action says what to do with them: accept lets the packet pass, drop throws it away without a word.

A match can name any of these, and every one it names must hold:

| In a match      | Holds when                                                                    |
| --------------- | ----------------------------------------------------------------------------- |
| `in_interface`  | the packet came in on this interface, such as the guests VLAN                 |
| `out_interface` | the packet would leave through this interface                                 |
| `src`           | the sender's address is in this prefix, such as `192.168.10.0/24`             |
| `protocol`      | the packet is TCP, UDP or ICMP (ICMP is what ping uses)                       |
| `dst_port`      | the packet is for this port, as in [Ports](/academy/beginner/ports)           |
| `state`         | the packet starts a new connection, or is a reply to one (more on this below) |

A rule that names nothing matches every packet.

For each packet, the router:

1. Takes the first rule.
2. If the packet matches it, does what the rule says, and stops.
3. If not, moves on to the next rule.
4. If no rule is left, does what the default says.

So the order is part of the meaning. "Guests to anywhere: accept" above "Guests stay off the home network: drop" lets guests into your home network, because the first rule matches first and the second is never read. Swap them, and guests are kept out.

<TryIt title="Make every packet right">

This is the router of the single-site network: home, guests and management VLANs on one side, the internet on its port `1g-1` on the other. These rules are about traffic passing through it, and three things are wrong with them. Click a packet to send it, see which rule decides, then change the rules until all five packets are right.

<FirewallRules part="forward" />

</TryIt>

The guest phone reached the printer because "Guests to anywhere" matched first; moving the drop rule above it fixes that. The stranger reached the laptop because no rule matched it, and the default was accept. Set the default to drop and the stranger is stopped, but so is the website's answer to the laptop, which no rule allowed either. That answer is the next idea.

<Quiz
  question="The rules are: 1. Home to the internet (in home, out 1g-1): accept. 2. Anything from home (in home): drop. The laptop at home opens a website. What happens?"
  :choices="['Accepted by rule 1', 'Dropped by rule 2', 'Dropped, because a drop rule always wins']"
  :answer="0"
  :why="['', 'Rule 2 is never read for this packet: rule 1 matched first and decided.', 'No kind of rule wins on its own. The first rule that matches decides, whatever its action is.']"
  explain="The packet came in on home and leaves on 1g-1, so rule 1 matches. It is the first match, so it decides, and rule 2 is not read."
/>

## Replies: established and related

A connection goes both ways. The laptop's request leaves through the router, and the website's answer comes back in from the internet. To a firewall, that answer looks like any other packet from outside.

The router can still tell them apart, because it remembers every connection it has let through. This memory is called <Term means="The router’s list of the connections passing through it, so it can tell an answer from a packet that starts something new.">connection tracking</Term>, and on many routers the translation table from [the NAT lesson](/academy/elementary/nat) is kept in it too. It gives each packet a state:

- **new**: the packet starts a connection.
- **established**: it belongs to a connection the router has already let through, such as the website's answer.
- **related**: it is not part of a connection, but belongs with one, such as an error message about it.

One rule near the top, "accept what is established or related", lets the answer back in for every connection you allowed. After it, the other rules only have to decide who may start a connection. And an answer only exists if the request got out: remove "Home to the internet" in the widget, and the website's answer becomes "no reply".

<Quiz
  question="The forward chain is default drop, and its only rule is Home to the internet: accept. The laptop opens a website. What happens?"
  :choices="['The page loads', 'The request leaves, but the answer is dropped', 'The request is dropped']"
  :answer="1"
  :why="['The answer comes in from the internet, and no rule accepts it, so the default drops it.', '', 'Home to the internet matches the request and accepts it.']"
  explain="The request matches the one rule. The answer does not, so the default drops it. A rule accepting established and related packets lets it back in."
/>

## Why default drop is safer

There are two ways to write a firewall:

- **Default accept**, with rules that drop what you do not want. Everything you forgot is let through, and you do not notice until someone uses it.
- **Default drop**, with rules that accept what you want. Everything you forgot is stopped, and you notice the same day, because something you use stops working.

The second fails safe. A list of what is allowed is also short and easy to check: home and guests reach the internet, answers come back, and nothing else gets through.

## To the router, or through it

A router does not check every packet against one list. It has separate lists, called <Term means="A list of firewall rules with its own default. A packet is checked against one chain, picked by where the packet is going.">chains</Term>:

- **input**: packets for the router itself, such as an SSH login to it, or a DNS question it answers.
- **forward**: packets passing through it, from one network to another, such as the laptop's request to a website.

A third chain, output, holds the packets the router sends itself, such as its own DNS questions. It is usually left open.

A packet is checked against one chain only. A rule in forward never sees a login to the router, and a rule in input never sees the laptop's request to a website. That is why the input chain needs its own default, and its own rule for replies.

<TryIt title="Two chains">

Both chains now, with all ten packets. The forward chain is already fixed. The input chain has one rule that should not be there. Send the login attempts from the stranger and the guest, and watch which chain decides.

<FirewallRules part="both" />

</TryIt>

If you changed "SSH from anywhere" to drop instead of removing it, your own login stopped too: it reached that rule before "Management". Move "Management" above it, or remove the rule: the default already drops what is not allowed.

<Quiz
  question="A guest phone asks the router itself for a name, with DNS. Which chain decides?"
  :choices="['input', 'forward', 'Both, one after the other']"
  :answer="0"
  :why="['', 'Forward is for packets passing through the router to another network. This one is for the router itself.', 'A packet is checked against one chain: input if it is for the router, forward if it passes through.']"
  explain="The packet is for the router itself, so input decides. In the single-site router, the rule DNS from guests accepts it."
/>

## In Circuit

The rules are written in the router's `firewall`, under `filter`, one chain each. This is the single-site router's:

```ts
firewall: {
    filter: {
        // Traffic to the router itself.
        input: {
            default: "drop",
            rules: [
                { description: "Replies", match: { state: ["established", "related"] }, action: "accept" },
                { description: "Ping", match: { protocol: "icmp" }, action: "accept" },
                { description: "Management", match: { src: MANAGEMENT }, action: "accept" },
                { description: "DNS from home", match: { in_interface: "home", protocol: "udp", dst_port: 53 }, action: "accept" },
                { description: "DNS from guests", match: { in_interface: "guests", protocol: "udp", dst_port: 53 }, action: "accept" },
            ],
        },
        // Traffic passing through the router: home and guests reach the internet, and nothing else gets through.
        forward: {
            default: "drop",
            rules: [
                { description: "Replies", match: { state: ["established", "related"] }, action: "accept", offload: true },
                { description: "Home to the internet", match: { in_interface: "home", out_interface: "1g-1" }, action: "accept" },
                { description: "Guests to the internet", match: { in_interface: "guests", out_interface: "1g-1" }, action: "accept" },
            ],
        },
    },
},
```

- `default` is what a packet no rule matched gets. Left out, it is accept, so both chains here write `drop`. There is no rule that keeps guests off the home network: nothing lets them there, so the default drops them.
- `action` is `accept`, `drop`, or `reject`, which drops the packet but answers the sender that it was refused.
- `offload: true` on a rule that accepts hands the rest of the connection to a faster path inside the router, past the rules below. It belongs on the rule for replies, which carries most of the traffic.
- `MANAGEMENT` is a constant both devices of the site share, holding `"192.168.10.0/24"`, the management network. The next lesson is about why only it may log in.

A chain is an ordered list, so when it changes Circuit replaces it as a whole: the new rules go in first, and only then are the old ones removed, so the router is never without rules ([How a change is applied](/guide/convergence)). An earlier version of this router had no default in its forward chain, and two rules keeping guests out. On a RouterOS router, `npx circuit diff` for the change to the one above ends like this, with the default written as a last rule:

```text
    + add action=accept chain=forward comment=Home to the internet in-interface=home out-interface=ether1
    + add action=accept chain=forward comment=Guests to the internet in-interface=guests out-interface=ether1
    + add action=drop chain=forward comment=Default
```

## In short

- A firewall reads its rules from the top. The first rule that matches decides, and a packet nothing matches gets the default.
- The order of the rules is part of their meaning: a broad accept above a narrow drop hides the drop.
- Connection tracking marks answers as established or related; one rule near the top lets them back in.
- Default drop with rules that accept what you want fails safe; default accept fails open.
- Packets for the router are checked against `input`, packets through it against `forward`. In Circuit both live in `firewall.filter`, each with `default` and `rules`.
