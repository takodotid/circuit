---
title: Opening a website
description: Everything between typing a name and seeing the page, step by step. Follow the whole journey, then put its steps back in order yourself.
---

# Opening a website

You type `circuit.tako.id`, press Enter, and a moment later the page is there. In that moment, your laptop uses every idea of this level, and one new one: the lock.

## The journey

<TryIt title="Follow the journey of one page">

<WebsiteJourney />

</TryIt>

<Quiz
  question="Why does the laptop send its DNS question to the home router, and not straight to the resolver?"
  :choices="['Because the home router knows every name', 'Because the resolver is on another network, and everything for another network goes to the gateway', 'Because DNS questions always go to the router first, whatever the address']"
  :answer="1"
  :why="['The home router passes the question on. The resolver and the servers it asks are what know the names.', '', 'It is not a rule about DNS. The laptop would ask a resolver on the home network directly.']"
  explain="198.51.100.53 is not on 192.168.1.0/24, so the laptop sends the question to its gateway, like any other packet for another network."
/>

## The lock

Your packets pass through many routers that belong to other people: your provider, the networks in between, and perhaps the Wi-Fi of a café. Each of them must read the addresses on a packet to pass it on. Without a lock, they could also read everything inside: the page, what you type into it, and your password.

HTTPS is web pages sent over a locked conversation. The lock does two things:

1. **A secret key.** The browser and the server agree on a key, a long secret number that only the two of them know. They use mathematics that lets two sides agree on a secret in the open. Someone who sees every message between them still cannot work out the key. From then on, everything they send is scrambled with that key, and only the other side can unscramble it.
2. **Proof of the name.** A key is no use if you share it with the wrong server. So the server shows a <Term means="A signed statement, from an organization your browser trusts, that a key belongs to a name such as circuit.tako.id.">certificate</Term>. It is a statement, signed by an organization your browser trusts, that this key belongs to `circuit.tako.id`. If the name does not match, or the signature is wrong, the browser warns you instead of showing the page.

The lock beside the address in your browser means both happened. It does not mean the site is honest. It means only that you are talking to whoever owns that name, and nobody on the way can read what you say.

::: warning What the lock does not hide
The routers on the way still see the addresses and ports on every packet, because they need them to pass it on. Often they can see the name of the site you asked for too. Only what is inside is locked: the page, and everything you send to it.
:::

<Quiz
  question="You log in to a site over HTTPS through a café’s Wi-Fi. What can the café’s router see?"
  :choices="['Your password', 'The page you are reading', 'The addresses and ports on your packets', 'Nothing at all']"
  :answer="2"
  :why="['Your password is inside the locked conversation. The router passes it on scrambled, and cannot unscramble it.', 'The page is inside the locked conversation too.', '', 'A router has to read the addresses to pass the packets on, so those are never locked.']"
  explain="The addresses and ports stay readable, because every router needs them. Everything inside the conversation is scrambled with a key the router does not have."
/>

## The ideas of this level

| Lesson                                                       | Where it was in the journey                                     |
| ------------------------------------------------------------ | --------------------------------------------------------------- |
| 1. [What is a network?](/academy/beginner/what-is-a-network) | The whole drawing: your home, your provider, and the internet.  |
| 2. [Cables, light, and radio](/academy/beginner/cables)      | Every link the messages crossed.                                |
| 3. [Messages in pieces](/academy/beginner/packets)           | The page coming back.                                           |
| 4. [Addresses](/academy/beginner/addresses)                  | The frame to the home router, and the IP address of the server. |
| 5. [Counting like a computer](/academy/beginner/binary)      | Every address on every card.                                    |
| 6. [Reading an IP address](/academy/beginner/ip-addresses)   | Near or far.                                                    |
| 7. [Switches](/academy/beginner/switches)                    | Inside the home, in the switch built into the home router.      |
| 8. [Routers and the gateway](/academy/beginner/routers)      | Every hop out and back.                                         |
| 9. [DNS](/academy/beginner/dns)                              | The first question.                                             |
| 10. [Ports and protocols](/academy/beginner/ports)           | DNS on port 53 over UDP, and the web on port 443 over TCP.      |

<TryIt title="Put the steps in order">

<JourneyOrder />

</TryIt>
