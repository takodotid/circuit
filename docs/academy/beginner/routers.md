---
title: Routers and the gateway
description: A device sends to its own network directly, and everything else to its gateway. Send packets across routers and watch each one look up the next hop.
---

# Routers and the gateway

A router joins one network to another. Your laptop sends packets for its own network straight to the device they are for. It sends every other packet to one router, its default gateway. Each router then passes the packet one step closer, until it arrives. No router knows the whole way, only the next step.

## Near or far: the first decision

Each time a device sends a packet, it first compares the destination's network part with its own, as in [Reading an IP address](/academy/beginner/ip-addresses). There are only two answers:

- **The same network**: the device sends the packet straight to the receiver. It puts the packet in a frame for the receiver's hardware address, and the switch delivers it, as in [Switches](/academy/beginner/switches).
- **A different network**: the device sends the packet to its default gateway.

## The default gateway

The <Term means="The router on your own network that a device sends every packet for other networks to.">default gateway</Term> is the router on your own network: the one way out. A device gets the gateway's address together with its own address when it joins the network. At home, the gateway is the home router, often at an address such as `192.168.1.1`.

Think of a building with a mail room. You take a note for a colleague on your floor to them yourself. Every letter for anywhere else goes to the mail room. But the mail room does not carry your letter all the way. It passes the letter to the next sorting office, which passes it on again. Routers work the same way.

A router sits on more than one network, so it has an address on each of them. In the office below, the main router is `192.168.1.1` on the office network. It is `10.0.0.1` on the cable to the library, and `198.51.100.2` on the cable to the internet provider. The laptop only needs to know the first one, its gateway.

<TryIt title="Send a packet across routers">

<RouterPath />

</TryIt>

To reach its gateway, the laptop puts the packet in a frame for the main router's hardware address. Each router then puts the packet in a new frame for the next stop, as in [Addresses](/academy/beginner/addresses).

<Quiz
  question="Your laptop is 192.168.1.20/24, and its gateway is 192.168.1.1. Which packet does it send to the gateway?"
  :choices="['A packet for 192.168.1.30', 'A packet for 192.168.1.200', 'A packet for 192.168.2.30']"
  :answer="2"
  :why="['192.168.1.30 is on the same /24 network as the laptop, so the laptop sends it straight there.', 'With a /24, the network part is the first three numbers: 192.168.1, the same as the laptop. It goes straight there.', '']"
  explain="The network part of 192.168.2.30 is 192.168.2, and the laptop is on 192.168.1. A different network means the packet goes to the gateway."
/>

## Finding a hardware address with ARP

A frame needs the receiver's hardware address, but a device usually knows only the receiver's IP address. It finds the hardware address with <Term means="Address Resolution Protocol: how a device finds the hardware address that belongs to an IP address on its own network. It asks every device at once, with a broadcast.">ARP</Term>, the broadcast question from [Switches](/academy/beginner/switches): "who has 192.168.1.30?". Only the device with that address answers. The asker keeps the answer in its <Term means="The list a device keeps of the hardware address behind each IP address on its own network, so it does not have to ask every time. Old entries are forgotten after a while.">ARP table</Term> for a while, so the next frame goes out at once.

A device asks only on its own network. For a far address, it does not ask for the far device at all. It asks for its gateway's hardware address and sends the frame there.

<TryIt title="Find a hardware address">

<ArpLookup />

</TryIt>

<Quiz
  question="Your laptop, 192.168.1.20/24, sends its first packet to a server at 203.0.113.80. Whose hardware address does it ask for?"
  :choices="['The server at 203.0.113.80', 'Its gateway, 192.168.1.1', 'Nobody, it already knows every hardware address']"
  :answer="1"
  :why="['The server is on another network. A broadcast never leaves the local network, so the server would never hear the question.', '', 'A device learns hardware addresses as it needs them, by asking. Until it asks, its ARP table is empty.']"
  explain="The server is on another network, so the frame goes to the gateway. The laptop asks for the gateway's hardware address, and the router takes it from there."
/>

## The routing table

A router's <Term means="The list a router keeps of the networks it can reach, and where to send a packet for each.">routing table</Term> is a list of networks. For each network, it says where to send a packet for it. There are two kinds of answer:

| Send to                       | Means                                                                                                 |
| ----------------------------- | ----------------------------------------------------------------------------------------------------- |
| Directly                      | The network is on one of the router's own sides. The router delivers the packet to the device itself. |
| The address of another router | The network is farther away. The router passes the packet to that router, the next step on the way.   |

Most tables end with a row for **anything else**: where to send a packet whose network is on no other row. For the main router, that is the internet provider. This row is the router's own default gateway, and it works the same way as the laptop's.

When a packet arrives, the router looks for the row whose network holds the destination address. If no row does, it uses the row for anything else. If it has no such row either, it drops the packet.

A packet from your home to a website far away may take ten or twenty hops, and every router on the way does the same.

<Quiz
  question="The main router receives a packet for 172.16.8.25. What does it do?"
  :choices="['Sends a copy out of every side, like a switch flooding', 'Finds the row for 172.16.8.0/24 and passes the packet to 10.0.0.2', 'Sends it back to the laptop, because the laptop should know the way', 'Sends it to the internet provider, because the provider knows everything']"
  :answer="1"
  :why="['A router never floods. It sends each packet one way, the one its table gives.', '', 'The laptop has done its part by sending to its gateway. Finding the way from here is the router’s job.', 'The provider is only for addresses on no other row. This one has a row of its own.']"
  explain="The router looks up the destination in its routing table. The row for 172.16.8.0/24 says to pass it to the library router at 10.0.0.2."
/>

## The TTL: a counter against loops

People write routing tables, and people make mistakes. Say one router sends a packet to a second router, and the second sends it back to the first. The packet goes round and round. Without something to stop it, it would circle forever and keep the cable busy.

So every packet carries a number called the <Term means="Time to live: a counter in every IP packet that each router lowers by one. At zero the packet is dropped, so it cannot loop forever.">TTL</Term>, short for time to live. Most devices start it at 64 or 128. Every router that passes the packet on lowers it by one. A router that lowers it to 0 drops the packet instead of passing it on.

In the next drawing, the main router still has a row for a reading room in the library that closed last year. The library router no longer knows that network. So it sends anything for it back to the main router, which sends it to the library again.

<TryIt title="Make a loop, and watch the TTL run out">

<RouterPath loop />

</TryIt>

The TTL does not fix the mistake. The packet is still lost, and the old row stays in the table until someone removes it. But the TTL limits the damage: a lost packet disappears after a few dozen hops instead of circling forever.

## Notes from the network

A router that drops a packet usually sends a short note back to the sender, saying why. These notes are called <Term means="Internet Control Message Protocol: short messages about delivery itself, such as a ping and its reply, or a router saying that a packet's TTL ran out.">ICMP</Term>. They carry no data of their own. They say what happened to other packets on the way. Two common tools are built on ICMP: **ping** and **traceroute**, which Windows calls `tracert`.

<TryIt title="Ping, then trace the way">

<PingTraceroute />

</TryIt>

**ping** sends an ICMP echo request, and the device answers with an echo reply. Each reply line says how long the round trip took, in ms (thousandths of a second). It also says the TTL the reply had left when it arrived.

No reply says less than it seems. `Request timed out.` only means that no answer came back. The device may be off, or nobody may have the address. Or a <Term means="A filter on a router that checks each packet against its rules, read from the top, and lets the packet pass or drops it.">firewall</Term> on the device may throw echo requests away.

**traceroute** finds the routers on the way by letting the TTL run out on purpose:

1. It sends packets with a TTL of 1. The first router lowers the TTL to 0 and drops them. It sends back an ICMP "time exceeded" note from its own address. That address, and the time the note took, are hop 1.
2. It sends packets with a TTL of 2. The first router lowers the TTL to 1 and passes them on. The second router lowers it to 0 and sends the notes. That is hop 2.
3. It goes on, one more each time, until a packet has enough TTL to reach the destination. The destination answers directly, and that is the last row.

A row of `* * *` means no note came back from that hop. Many routers send no ICMP notes, or only a few a second, to save work. Some networks filter the notes out. So stars in the middle do not mean the way is broken, as long as later hops answer. Stars point at a real problem only when they never stop and the destination never answers. Even then, a firewall at the destination may be the reason.

<Quiz
  question="A traceroute shows hop 4 as * * *, and hops 5 to 8 answer, the last one being the server. What does row 4 tell you?"
  :choices="['The way is broken at hop 4, so the server cannot be reached', 'The router at hop 4 passes packets on, but sends no ICMP notes of its own', 'There is no router at hop 4', 'The answers from hop 4 came back too fast to measure']"
  :answer="1"
  :why="['Hops 5 to 8 answered, and their packets went through hop 4. The way works.', '', 'Some router lowered the TTL to 0 there and dropped the packet. It was there, but it stayed quiet.', 'A star means no answer came at all, not a fast one.']"
  explain="The packets with a TTL of 5 and more went through hop 4 and got answers, so the router there passes packets on. It just sends no time exceeded notes, so tracert has nothing to print for its row."
/>

So a firewall often lets ICMP through on purpose. A network that drops every ICMP note is harder to fix when something breaks.

<Quiz
  question="A packet leaves your laptop with a TTL of 64 and passes through 5 routers before it arrives. What is its TTL when it arrives?"
  :choices="['64', '59', '5', '0']"
  :answer="1"
  :why="['Every router on the way lowers the TTL by one, so it cannot still be 64.', '', 'The TTL counts down from where the sender set it. It does not count the hops up from zero.', 'A packet whose TTL reaches 0 is dropped. This one arrived.']"
  explain="Each of the 5 routers lowers it by one: 64 minus 5 is 59."
/>
