---
title: "Sharing one address: NAT"
description: How a whole home reaches the internet through one public address. Open connections, watch the router's table fill, then try to get in from outside.
---

# Sharing one address: NAT

Every device in your home has a private address, such as 192.168.20.10, and the internet does not carry packets to private addresses. So the router swaps it. On the way out, it replaces the private address and port of each connection with its own public address and a port of its own, and writes the pair down. When the reply comes back to that port, the router looks it up and swaps it back. This is <Term means="Network address translation: rewriting the addresses in packets as they pass through a router.">NAT</Term>.

The list the router keeps is the whole trick. It is also why nobody outside can start a connection to a device at home, unless you add a rule that says where it should go.

## Why one address is shared

An IPv4 address is 32 bits, so there are about 4.3 billion of them. There are more devices in the world than that, and many addresses are set aside for other uses, so not every device can have one of its own.

The private ranges from [Reading an IP address](/academy/beginner/ip-addresses) are the way out: 10.0.0.0/8, 172.16.0.0/12 and 192.168.0.0/16. Any home or office may use them, so millions of homes use 192.168.1.0/24 at the same time. That is exactly why they cannot be used on the internet: a reply to 192.168.20.10 could be meant for any of those homes, so routers on the internet carry no routes to private addresses at all.

Your internet provider gives your router one <Term means="An address that belongs to one place on the whole internet, so a reply to it can find its way back. Your internet provider gives you one.">public address</Term>. In the single-site network you will build in this level, it is 203.0.113.2, on the router's port to the provider. Every device at home shares it.

## What the router rewrites

An address and a port are often written together with a colon, such as 192.168.20.10:51000. When the laptop opens a website:

1. The laptop sends a packet from 192.168.20.10:51000 to the website at 198.51.100.7:443.
2. The router replaces the sender with its public address and a port it picks, such as 203.0.113.2:40001. It writes a row in its <Term means="The list a router keeps of every connection it rewrote: which inside address and port became which outside port, and who is at the other end.">translation table</Term>: 192.168.20.10:51000 is 203.0.113.2:40001, talking to 198.51.100.7:443.
3. The website sees a packet from 203.0.113.2:40001, and answers it there.
4. The answer reaches the router. The router finds port 40001 in its table, puts 192.168.20.10:51000 back as the receiver, and passes the packet in.

The port is what makes sharing work. With one public address for everyone, the address alone cannot say which device an answer is for, but the router's port can.

<TryIt title="Open connections through one address">

Open a connection from the laptop, then one from the phone, and watch the table and what the packet says at each moment. Then be the stranger: connect from outside, first to port 8443, then to a port that is in the table.

<NatTable />

</TryIt>

The website never learned the laptop's address: it only ever saw 203.0.113.2. Look at the phone's row too. The phone picked port 51000, the same as the laptop, and the router told the two apart by giving each its own outside port. Some routers keep the device's own port when no other connection is using it, and pick a new one only when they must. The router in the widget always picks a new one, so the two sides are easy to tell apart.

The table does not grow forever. A row is removed when its connection ends, or after it has been quiet for a while.

<Quiz
  question="An answer arrives at 203.0.113.2, port 40002. How does the router know which device at home it is for?"
  :choices="['It reads the private address inside the answer', 'It looks up port 40002 in its translation table', 'It sends the answer to every device at home']"
  :answer="1"
  :why="['The website only ever saw 203.0.113.2, so the answer holds no private address to read.', '', 'A router passes a packet on to one place. It does not need to guess: its table says where port 40002 goes.']"
  explain="Port 40002 is in the table, next to the private address and port that opened the connection. The router puts those back and passes the answer in."
/>

## Nobody can start a connection in

Every row in the table is written by a packet going out. A packet that arrives from the internet for a port no row names has nowhere to go: the router cannot know which of the devices at home it is meant for, so it stops there.

A port that is in the table does not help a stranger either. The row also remembers who is at the other end, and the stranger is not the website the laptop talked to. Some home routers are looser and let anyone use a row once it exists, but the idea is the same: the row was opened from inside.

To let a connection in on purpose, you add a <Term means="A rule that sends everything arriving at one port of the public address to one device inside. Also called destination NAT.">port forward</Term>: "whatever arrives at 203.0.113.2, port 8443, goes to the camera at 192.168.20.50, port 443". It is also called destination NAT, because it rewrites the receiver of a packet, where the rewriting so far changed the sender. With it turned on, the stranger in the widget reached the camera, and the router wrote a row for that connection too, so the camera's answers go back out the same way.

::: warning A port forward is open to everyone
Anyone on the internet who tries port 8443 reaches the camera, not only you. Forward only what must be reachable from outside, and remove a forward you no longer need.
:::

<Quiz
  question="Your router has no port forward. Someone on the internet opens a connection to your public address, port 22. What happens?"
  :choices="['It reaches the first device at home', 'It stops at the router, because no row says where it goes', 'It reaches every device at home']"
  :answer="1"
  :why="['The router does not pick a device for it. Nothing in its table says which device the packet is for.', '', 'A router does not copy a packet to every device. With no row and no forward, it has no place to send it.']"
  explain="Rows are only written by connections going out. Without a row or a port forward for port 22, the packet has nowhere to go inside."
/>

## NAT is not a firewall

Because nobody can start a connection in, NAT is often said to protect a home. On its own, it does not:

- It decides nothing about what goes out. Any device at home can connect to anything.
- It does not stop a packet sent straight to a private address. A computer in your provider's network can send a packet for 192.168.20.10 to your router's outside port. NAT has no row for it, and needs none: the router knows the way to 192.168.20.0/24, so it simply routes the packet in.
- It does nothing for the router itself. A login attempt to 203.0.113.2, port 22, is for the router, and NAT never touches it.

Deciding what may pass is the job of a firewall, and that is the next lesson. In the single-site router, its forward chain is what drops that packet for 192.168.20.10.

<Quiz
  question="Which of these does NAT stop on its own?"
  :choices="['A device at home opening any website', 'A connection from the internet to a port that no row names', 'A packet for 192.168.20.10 sent to your router by a computer in your provider’s network']"
  :answer="1"
  :why="['NAT rewrites connections going out. It lets every one of them out.', '', 'NAT has no row for that packet and needs none. The router knows the way to 192.168.20.0/24 and routes it in. Only a firewall rule stops it.']"
  explain="A connection starting from outside has no row and no forward, so it has nowhere to go. That is the only thing NAT stops, and only as a side effect."
/>

## In Circuit

NAT is written in the router's `firewall`, under `nat`. The single-site router has one rule:

```ts
firewall: {
    // filter: the rules of the next lesson.
    nat: {
        source: [{ description: "Share the public address", match: { out_interface: "1g-1" }, action: "masquerade" }],
    },
},
```

- `source` holds the rules that rewrite the sender, on the way out.
- `match: { out_interface: "1g-1" }` limits the rule to packets leaving through `1g-1`, the port to the provider. Traffic between the VLANs at home keeps its own addresses.
- `action: "masquerade"` means: use the address of the port the packet leaves through, whatever it is now. If your provider changes your public address, the rule still works. With a fixed address, `action: "snat"` and `to: "203.0.113.2"` write it out instead.

A port forward goes in `destination`, with `action: "dnat"`, the address to send it `to`, and `to_port`. On a router whose forward chain drops by default, as the single-site router's does, the forwarded connection also needs a rule there that accepts it: the next lesson is about those rules. Turn on the port forward in the widget to see it written. Every field is in the [schema reference](/reference/schema).

Circuit turns the rule into each vendor's own command. For the router in the template, a RouterOS router, `npx circuit build router` prints this line for it:

```text
add action=masquerade chain=srcnat comment="Share the public address" out-interface=ether1
```

`1g-1` became `ether1`, the router's own name for its first 1G port: see [Port names](/guide/devices#port-names).

## In short

- Homes and offices use private addresses inside, and share one public address outside.
- The router rewrites the sender's address and port of each connection going out, and remembers the pair in its translation table so the answer finds its way back.
- Nothing from outside can start a connection in, unless a port forward says where it goes, and then anyone can.
- NAT is not a firewall: it lets everything out, and does not stop packets sent straight to a private address.
- In Circuit, `firewall.nat.source` with `action: "masquerade"` shares the address; `firewall.nat.destination` with `action: "dnat"` forwards a port.
