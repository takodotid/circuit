---
title: Firewalls
description: A firewall decides which traffic may pass, by rules read from the top. Reorder and change rules, send test packets, and write the rules in Circuit.
---

# Firewalls

A firewall is a list of rules on the router that decides, for each packet, whether it may pass. The router reads the rules from the top, and the first rule that matches the packet decides what happens to it. The rules after it are not read. A packet that no rule matches gets the default, which is written at the end.

## Rules, read from the top

A rule has two parts. Its match says which packets it is about, and its action says what to do with them. Accept lets the packet pass, and drop throws it away without a word.

A match can use any of these fields, and every field it uses must be true for the packet:

| In a match         | True when                                                                  |
| ------------------ | -------------------------------------------------------------------------- |
| `in_interface`     | the packet came in on this interface, such as the guests VLAN              |
| `out_interface`    | the packet would leave through this interface                              |
| `src`              | the sender's address is in this prefix, such as `192.168.10.0/24`          |
| `protocol`         | the packet is TCP, UDP, or ICMP (ICMP is what ping uses)                   |
| `dst_port`         | the packet is for this [port](/academy/beginner/ports), such as 53 for DNS |
| `connection_state` | the packet is a reply, or starts a new connection: see the next section    |

A rule that uses none of them matches every packet.

The order is part of the meaning. Put "Guests to anywhere: accept" before "Guests stay off the home network: drop", and guests get into your home network. The first rule matches first, and the second is never read. Swap them, and guests are kept out.

<TryIt title="Make every packet right">

These rules are for traffic through the single-site router, and three things are wrong with them.

<FirewallRules part="forward" />

</TryIt>

The guest phone reached the printer because "Guests to anywhere" matched first. Move the drop rule before it to fix that. The stranger reached the laptop because no rule matched it, and the default was accept. With the default set to drop, the stranger is stopped. But so is the website's answer to the laptop, because no rule allows it either.

<Quiz
  question="The rules are: 1. Home to the internet (in home, out 1g-1): accept. 2. Anything from home (in home): drop. The laptop at home opens a website. What happens?"
  :choices="['Accepted by rule 1', 'Dropped by rule 2', 'Dropped, because a drop rule always wins']"
  :answer="0"
  :why="['', 'Rule 2 is never read for this packet: rule 1 matched first and decided.', 'No kind of rule wins on its own. The first rule that matches decides, whatever its action is.']"
  explain="The packet came in on home and leaves on 1g-1, so rule 1 matches. It is the first match, so it decides, and rule 2 is not read."
/>

## Replies: established and related

A connection goes both ways. The laptop's request leaves through the router, and the website's answer comes back in from the internet. To a firewall, that answer looks like any other packet from outside.

The router can still tell them apart, because it remembers every connection it has let through. This memory is called <Term means="A router keeping a list of the connections passing through it, so it can tell a reply from a packet that starts a new connection. The list is called the connection table.">connection tracking</Term>. On many routers, the [translation table](/academy/elementary/nat) of NAT is kept in it too. It gives each packet a state:

- **new**: the packet starts a connection.
- **established**: it belongs to a connection the router has already let through, such as the website's answer.
- **related**: it is not part of a connection, but belongs with one, such as an error message about it.

One rule near the top, "accept what is established or related", lets the answer back in for every connection you allowed. After it, the other rules only have to decide who may start a connection. An answer only exists if the request got out. Remove "Home to the internet" in the widget, and the website's answer shows "no reply".

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

A router does not check every packet against one list. It has separate lists, called <Term means="A list of firewall rules with its own default action. A packet is checked against one chain, chosen by where the packet is going.">chains</Term>:

- **input**: packets for the router itself, such as an SSH login to it, or a DNS question it answers.
- **forward**: packets passing through it, from one network to another, such as the laptop's request to a website.

A third chain, output, is for the packets the router sends itself, such as its own DNS questions. It is usually left open.

A packet is checked against one chain only. A rule in forward never sees a login to the router, and a rule in input never sees the laptop's request to a website. That is why the input chain needs its own default, and its own rule for replies.

<TryIt title="Two chains">

The forward chain is fixed, and the input chain has one rule that should not be there. Send the login attempts from the stranger and the guest, and watch which chain decides.

<FirewallRules part="both" />

</TryIt>

If you changed "SSH from anywhere" to drop instead of removing it, your own login stopped too: it reached that rule before "Management". Move "Management" before it, or remove the rule, because the default already drops what is not allowed.

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
            default_action: "drop",
            rules: [
                { description: "Replies", if: { connection_state: ["established", "related"] }, then: "accept" },
                { description: "Ping", if: { protocol: "icmp" }, then: "accept" },
                { description: "Management", if: { src: home.addresses.management }, then: "accept" },
                { description: "DNS from home", if: { in_interface: "home", protocol: "udp", dst_port: 53 }, then: "accept" },
                { description: "DNS from guests", if: { in_interface: "guests", protocol: "udp", dst_port: 53 }, then: "accept" },
            ],
        },
        // Traffic through the router: home and guests reach the internet, and nothing else gets through.
        forward: {
            default_action: "drop",
            rules: [
                { description: "Replies", if: { connection_state: ["established", "related"] }, then: "accept", fast_path: true },
                { description: "Home to the internet", if: { in_interface: "home", out_interface: "1g-1" }, then: "accept" },
                { description: "Guests to the internet", if: { in_interface: "guests", out_interface: "1g-1" }, then: "accept" },
            ],
        },
    },
},
```

- `default_action` says what happens to a packet that no rule matched. If you leave it out, it is accept, so both chains here write `drop`. There is no rule that keeps guests off the home network: nothing lets them there, so the default drops them.
- Each rule is `if`, the packets it matches, and `then`, what happens to them: `accept`, `drop`, or `reject`, which drops the packet but tells the sender it was refused.
- `fast_path: true` on a rule that accepts sends the rest of the connection down a faster path inside the router, which skips the rules after it. Put it on the rule for replies, which matches most of the traffic.
- `home.addresses.management` is a value from the site's `site.ts`, which both devices share. It is `"192.168.10.0/24"`, the management network.

A chain is an ordered list, so Circuit swaps a changed chain whole, as [Make a change](/guide/apply#making-the-plan) explains. Say an earlier version of this router had no default in its forward chain, and two rules keeping guests out. On RouterOS, the `/ip firewall filter` part of `circuit diff router` for this change ends like this, with the default as a last rule:

```text
    + add action=accept chain=forward comment=Home to the internet in-interface=home out-interface=ether1
    + add action=accept chain=forward comment=Guests to the internet in-interface=guests out-interface=ether1
    + add action=drop chain=forward comment=Default
```
