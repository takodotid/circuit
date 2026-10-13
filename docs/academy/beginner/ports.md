---
title: Ports and protocols
description: One device runs many programs, told apart by port numbers. Knock on a server's ports, then race TCP against UDP over a link that loses packets.
---

# Ports and protocols

One device can run many programs that use the network at the same time: a website, a mail server, a way to log in. Every packet carries a port number that says which program it is for, so an IP address and a port together name one program on one device.

Programs also choose how they send. TCP holds a conversation that checks every piece arrived, in order. UDP just sends, which is faster but checks nothing.

## One address, many programs

An IP address gets a packet to the right device, the way a street address gets a letter to the right building. Inside, the letter still needs a flat number to reach the right door. On a device, that number is the <Term means="A number from 0 to 65535 on every packet that says which program on the device the packet is for.">port</Term>.

The picture stops being true here: a port is not a place inside the device. It is a number that a program asks the device for when it starts, so that packets with that number are handed to it. For the programs everyone needs to find, the numbers are agreed in advance:

| Port | The program behind it                                                  |
| ---- | ---------------------------------------------------------------------- |
| 80   | Web pages (HTTP)                                                       |
| 443  | Web pages, locked so nobody on the way can read them (HTTPS)           |
| 53   | DNS, the answers you met in [Names and numbers](/academy/beginner/dns) |
| 22   | SSH: logging in to another computer and typing commands on it          |
| 25   | Mail passed from one mail server to another (SMTP)                     |
| 21   | FTP, an old way of sending files that sends the password as plain text |

A port number is 16 bits, so it goes from 0 to 65535. An address and a port are written together with a colon: `203.0.113.80:443` is the locked web program on the server at `203.0.113.80`.

::: tip Not the switch kind
In [Switches](/academy/beginner/switches), a port was a socket for a cable. Here it is a number on a packet. The two have nothing to do with each other except the word.
:::

<TryIt title="Knock on a server's ports">

Send requests to different ports of the same server, and see which program answers. Then try a port with no program behind it.

<ServerPorts />

</TryIt>

Look at the line under the buttons after each request. The laptop's side has a port too: a free number it picks for this one conversation, usually a high one, and a new one each time. The reply is sent back to that number. That is how a reply finds the right program on your side, and the right conversation when one program, such as your browser, has several open at once.

<Quiz
  question="One server at 203.0.113.80 runs a website and answers DNS questions. How does a DNS question reach the DNS program, and not the website?"
  :choices="['It is sent to a different IP address', 'It carries port 53, and the website listens on 443', 'The server reads every packet and guesses', 'The switch sends it to the right program']"
  :answer="1"
  :why="['Both programs are on the same device, with the same address. The address alone cannot tell them apart.', '', 'The server does not guess. The port number on the packet says exactly which program it is for.', 'A switch delivers frames to devices by hardware address. It knows nothing about the programs inside a device.']"
  explain="The address gets the packet to the server, and the port number, 53, gets it to the DNS program on it."
/>

## Two ways to send: TCP and UDP

In [Messages in pieces](/academy/beginner/packets) you saw that packets can be lost, or arrive in a different order than they were sent. Some programs must get every piece; others would rather skip a piece than wait for it. So there are two common <Term means="A set of rules two programs agree on for how they talk to each other.">protocols</Term>, sets of rules for sending, and every packet uses one of them. Both carry port numbers.

**TCP** (Transmission Control Protocol) holds a conversation:

1. Before any data, the two sides exchange three short messages, the **handshake**: "hello?", "hello!", "ok". Now each knows the other is there and ready.
2. Every piece of data is numbered, and the receiver answers each with "got it".
3. If a "got it" does not come back in time, the sender sends that piece again.
4. The receiver hands the pieces to its program in order, holding back any that arrived early until the gaps are filled.

**UDP** (User Datagram Protocol) just sends. There is no handshake, no "got it", nothing sent again, and nothing put back in order. Each packet goes once, and the program on the other side gets whatever arrives, in the order it arrives.

<TryIt title="Race TCP against UDP">

Start the race with some loss, and watch both lanes. Then try heavy loss, and no loss at all.

<TcpUdpRace />

</TryIt>

UDP finished first every time, even with no loss at all, because it never waits: not for a handshake, and not for a "got it". But with loss, its word has holes, and its letters can come in the wrong order. TCP took longer, and longer still with every lost piece, yet its program always got the whole word, in order.

Neither is better. They are for different jobs.

## Which one, when

| What it is for                      | Sent with   | Why                                                                                                            |
| ----------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------- |
| Web pages, email, downloads, SSH    | TCP         | A page or a file with a missing piece is broken. Waiting a little is better.                                   |
| Voice and video calls, online games | UDP         | A piece that arrives late is useless: the moment has passed. Better to skip it and carry on.                   |
| DNS                                 | UDP, mostly | One small question and one small answer. Asking again is quicker than a handshake. Very large answers use TCP. |

::: info A newer way for the web
Some websites now send pages over UDP with a newer method called HTTP/3. It runs on QUIC, which does its own checking, resending and locking on top of UDP. The idea is the same: every piece must arrive. These lessons follow the classic way, over TCP.
:::

<Quiz
  question="You are on a video call, and one packet of sound is lost. What is the better thing for the call to do?"
  :choices="['Stop and wait until the lost packet is sent again', 'Skip it and keep going', 'Start the call again']"
  :answer="1"
  :why="['By the time the packet came again, the moment it belonged to would have passed, and the call would stutter.', '', 'One lost packet is a tiny gap. Starting again would lose far more.']"
  explain="In a call, a late piece is worth nothing, so skipping it is better than waiting. That is why calls use UDP."
/>

<Quiz
  question="What does the TCP handshake do?"
  :choices="['It locks the data so nobody can read it', 'It checks that both sides are there and ready before any data is sent', 'It finds the address of a name', 'It picks the fastest way through the routers']"
  :answer="1"
  :why="['Locking the data is a separate step, which the next lesson shows. The handshake only opens the conversation.', '', 'That is DNS, which happens before the handshake.', 'The routers choose the way, packet by packet, with their routing tables. TCP does not.']"
  explain="Three short messages, hello?, hello! and ok, open the conversation so both sides know the other is ready."
/>

## In short

- One device runs many programs; the port number on a packet says which program it is for.
- An address and a port together, such as `203.0.113.80:443`, name one program on one device. Your side of a conversation has a port too.
- Well-known ports: 80 and 443 for the web, 53 for DNS, 22 for SSH, 25 for mail between servers.
- TCP opens with a handshake, checks every piece arrived, sends lost ones again and keeps them in order.
- UDP just sends: faster, with no checking. It suits calls, games and DNS.
