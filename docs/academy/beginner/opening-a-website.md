---
title: Opening a website
description: Everything between typing a name and seeing the page, step by step. Follow the whole journey, then put its steps back in order yourself.
---

# Opening a website

You type `circuit.tako.id`, press Enter, and a moment later the page is there. In that moment your laptop uses every idea of this level: it turns the name into an address, decides the address is far away, sends to its gateway, opens a conversation with port 443, locks it, asks for the page, and puts the page back together from packets.

This lesson follows that journey from start to end, then looks at the one new idea in it: the lock.

## Before you type

Your laptop is already on the home network, and it was given what it needs when it joined:

- its own IP address, here `192.168.1.20`, and the size of its network, `/24`;
- its gateway, the home router at `192.168.1.1`;
- the address of a DNS resolver to ask, here `198.51.100.53`.

How it got them, automatically, is the subject of [a lesson in the Elementary level](/academy/elementary/dhcp). For now they are simply there. The addresses in this lesson are example addresses, kept for teaching.

## The journey

<TryIt title="Follow the journey of one page">

Step through it with **Next step**. Watch which hops each message crosses, and read what the message says on the card under the drawing.

<WebsiteJourney />

</TryIt>

Here is the same journey in words, with the lesson each step comes from:

1. **The name becomes an address.** The browser does not know the address of `circuit.tako.id`, so the laptop asks its resolver, which asks the root, the `.id` servers and the `tako.id` servers. The answer is `203.0.113.80`, and it is remembered for a while. ([DNS](/academy/beginner/dns))
2. **Near or far.** The laptop compares the network part of `203.0.113.80` with its own. They differ, so the packets go to the gateway. ([Reading an IP address](/academy/beginner/ip-addresses), [Routers](/academy/beginner/routers))
3. **Out of the home.** Each packet leaves in a frame for the home router's hardware address. The home router, and then every router after it, looks up the destination in its routing table, lowers the TTL and passes the packet one hop on, in a new frame each time. ([Addresses](/academy/beginner/addresses), [Switches](/academy/beginner/switches), [Routers](/academy/beginner/routers))
4. **The handshake.** The browser opens a TCP conversation with port 443 on the server: hello?, hello!, ok. ([Ports and protocols](/academy/beginner/ports))
5. **The lock.** The browser and the server agree on a secret key, and the server proves it is `circuit.tako.id`. This is the new part, below.
6. **The request and the reply.** The browser asks for the page. The page comes back cut into numbered packets, possibly by different ways, and TCP puts them back in order and has lost ones sent again. ([Messages in pieces](/academy/beginner/packets))
7. **The page.** The browser reads the page, fetches the pictures and styles it names in the same way, and draws it.

Even the DNS question in step 1 crossed the gateway: the resolver is not on the home network either. Every message, of every kind, makes the same near-or-far decision first.

<Quiz
  question="Why does the laptop send its DNS question to the home router, and not straight to the resolver?"
  :choices="['Because the home router knows every name', 'Because the resolver is on another network, and everything for another network goes to the gateway', 'Because DNS questions always go to the router first, whatever the address']"
  :answer="1"
  :why="['The home router passes the question on. The resolver and the servers it asks are what know the names.', '', 'It is not a rule about DNS. A resolver on the home network itself would be asked directly.']"
  explain="198.51.100.53 is not on 192.168.1.0/24, so the laptop sends it to its gateway, like any other packet for another network."
/>

## The lock: HTTPS in plain words

Your packets pass through many routers that belong to other people: your provider, the networks in between, perhaps the Wi-Fi of a café. Each of them has to read the addresses on a packet to pass it on, and without a lock, they could also read everything inside: the page, what you type into it, your password.

HTTPS is web pages sent over a locked conversation. The lock does two things, in step 5 of the journey:

1. **A secret key.** The browser and the server agree on a key, a long secret number, that only the two of them know. They do it with mathematics that lets two sides agree on a secret in the open: someone who sees every message they exchange still cannot work the key out. From then on, everything they send is scrambled with that key, and only the other side can unscramble it.
2. **Proof of the name.** A key is no use if you share it with the wrong server. So the server shows a <Term means="A signed statement, from an organisation your browser trusts, that a key belongs to a name such as circuit.tako.id.">certificate</Term>: a statement, signed by an organisation your browser trusts, that says this key belongs to `circuit.tako.id`. If the name does not match, or the signature is wrong, the browser warns you instead of showing the page.

The lock beside the address in your browser means both happened. It does not mean the site is honest: only that you are talking to whoever owns that name, and nobody on the way can read what you say.

::: warning What the lock does not hide
The routers on the way still see the addresses and ports on every packet, because they need them to pass the packet on. In most cases the name of the site you asked for can be seen too. What is locked is what is inside: the page, and everything you send to it.
:::

<Quiz
  question="You log in to a site over HTTPS through a café’s Wi-Fi. What can the café’s router see?"
  :choices="['Your password', 'The page you are reading', 'The addresses and ports on your packets', 'Nothing at all']"
  :answer="2"
  :why="['Your password is inside the locked conversation. The router passes it on scrambled, and cannot unscramble it.', 'The page is inside the locked conversation too.', '', 'A router has to read the addresses to pass the packets on, so those are never locked.']"
  explain="The addresses and ports stay readable, because every router needs them. Everything inside the conversation is scrambled with a key the router does not have."
/>

## Put the journey in order

Now without the drawing: here are the steps, jumbled. Put them back in the order they happen.

<TryIt title="Put the steps in order">

<JourneyOrder />

</TryIt>

## The ten ideas of this level

Every lesson of the Beginner level had a part in opening one page:

| Lesson                                                       | The idea                                                              | Where it was in the journey                                 |
| ------------------------------------------------------------ | --------------------------------------------------------------------- | ----------------------------------------------------------- |
| 1. [What is a network?](/academy/beginner/what-is-a-network) | Devices joined by links; the internet is networks joined together.    | The whole drawing: your home, your provider, the internet.  |
| 2. [Messages in pieces](/academy/beginner/packets)           | Data travels in numbered packets, and is put back in order.           | The page coming back.                                       |
| 3. [Addresses](/academy/beginner/addresses)                  | A hardware address for the local network, an IP address for anywhere. | The frame to the home router; the IP address of the server. |
| 4. [Counting like a computer](/academy/beginner/binary)      | Numbers in bits, each part of an address 0 to 255.                    | Every address on every card.                                |
| 5. [Reading an IP address](/academy/beginner/ip-addresses)   | The network part and the prefix, such as `/24`.                       | Near or far.                                                |
| 6. [Switches](/academy/beginner/switches)                    | Frames delivered by hardware address, learned from the sender.        | Inside the home, in the switch built into the home router.  |
| 7. [Routers and the gateway](/academy/beginner/routers)      | The gateway, routing tables, hop by hop, the TTL.                     | Every hop out and back.                                     |
| 8. [Names and numbers: DNS](/academy/beginner/dns)           | A name turned into an address by a resolver, and remembered.          | The first question.                                         |
| 9. [Ports and protocols](/academy/beginner/ports)            | Port numbers; TCP checks, UDP just sends.                             | DNS on port 53 over UDP; the web on port 443 over TCP.      |
| 10. Opening a website                                        | All of it together, and the lock.                                     | This page.                                                  |

With these ten ideas you can follow any message across any network. The Elementary level puts them to work: you build a small network of your own, with a switch and a router, and write each device down in Circuit as you go.

## In short

- Opening a page starts with DNS: the name becomes an address, asked of the resolver through the gateway.
- The laptop sends everything for another network to its gateway, and routers pass it on hop by hop.
- The browser opens a TCP conversation with port 443, then locks it: a secret key only the two sides know, and a certificate that proves the server's name.
- The page comes back in numbered packets, is put back in order, and is drawn; the lock means nobody on the way can read it.
