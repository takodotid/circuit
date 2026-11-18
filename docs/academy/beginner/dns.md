---
title: "Names and numbers: DNS"
description: DNS turns a name like circuit.tako.id into an IP address. Step through a lookup from the root down, and see why the second one is instant.
---

# Names and numbers: DNS

People use names, such as `circuit.tako.id`. Networks deliver packets only to IP addresses, such as `203.0.113.80`. <Term means="Domain Name System: the system that turns a name such as circuit.tako.id into the IP address it stands for.">DNS</Term>, the Domain Name System, turns the name into the address.

::: info The addresses in this lesson
The addresses here are examples. A real lookup of `circuit.tako.id` gives a different address.
:::

## Why names

A name is easier to remember than four numbers. A name also lets a website move. A website can move to another server with another address. If everyone used the address, everyone would have to learn the new one. With a name, the owner changes the address behind the name, and nobody else notices.

DNS works like the contacts on your phone: you tap a name, and the phone dials the number behind it. But your contacts are yours alone, kept on your phone. DNS is one book shared by the whole internet. No single computer has all of it. It is split over many servers, and each server has its own part.

## Reading a name

You read a name from right to left, from the most general part to the most exact:

| Part              | What it is                                                                                                                                                 |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`              | The top of the name. `.id` is the ending for Indonesia. Others are `.com`, `.org`, and `.uk`.                                                              |
| `tako.id`         | A <Term means="A name someone has registered, such as tako.id. Its owner decides what names exist under it.">domain</Term>, a name someone has registered. |
| `circuit.tako.id` | One name inside that domain, chosen by the domain's owner.                                                                                                 |

At the very top is the root, the starting point of every name on the internet. Each level knows only the level just under it. The root knows who looks after `.id`. The `.id` servers know who looks after `tako.id`. The `tako.id` servers know the names inside it.

## A lookup, step by step

Your device does not ask all of these servers itself. It asks a <Term means="A server that looks up names for you. It asks the other DNS servers, and remembers their answers.">resolver</Term>, a server that does the asking for it. Your internet provider usually runs one. Your device learns the address of the resolver when it joins a network. It gets its own address and gateway at the same time. The resolver knows where the root servers are from the start. There is a small, fixed set of them, each copied to many places around the world.

<TryIt title="Look up circuit.tako.id">

Step through it once. Then pick who already remembers the answer, and step through again.

<DnsLookup />

</TryIt>

Each server knows only its own part and where to go next, like each router knows only the next hop. So no server has to know every name in the world.

<Quiz
  question="Which server has the address of circuit.tako.id itself?"
  :choices="['A root server', 'A server for .id', 'A server for tako.id', 'Your laptop']"
  :answer="2"
  :why="['The root only knows who looks after each ending, such as .id. It points the resolver onward.', 'The .id servers only know who looks after each domain under .id, such as tako.id.', '', 'Your laptop only remembers an answer after it has asked for it.']"
  explain="The servers for tako.id have the domain’s own list of names. The root and the .id servers only point the resolver closer to them."
/>

## Remembering answers

Four questions for every name would be slow, and the root and `.id` servers would get the same questions all day. So every answer comes with a number of seconds that it may be remembered for. This number is the answer's <Term means="Time to live in DNS: how many seconds an answer may be remembered before it must be asked for again.">TTL</Term>, or time to live. The resolver and your laptop each keep the answer until that time runs out. Until then, they answer from memory.

TTL also means the counter on a packet from [Routers and the gateway](/academy/beginner/routers). Both say how long something may live.

<TryIt title="Watch the resolver remember and forget">

The times are examples. A real lookup takes from a few milliseconds to a few hundred.

<DnsMemory />

</TryIt>

Remembering has a cost. When a website moves to a new address, resolvers that still remember the old answer keep giving it out until its TTL runs out. So a change to a name can take a while to reach everyone. People often lower a TTL a day before they move a site.

<Quiz
  question="The answer for shop.example.com came with a TTL of 60. Two minutes later, someone asks the same resolver for that name again. What does the resolver do?"
  :choices="['Answers from memory at once', 'Asks the servers again for a fresh answer', 'Says the name does not exist']"
  :answer="1"
  :why="['The answer could be kept for 60 seconds, and two minutes is 120. It has been forgotten.', '', 'The name still exists. The resolver only forgot the answer, so it looks it up again.']"
  explain="After 60 seconds, the resolver forgets the answer, so it looks the name up again. The new answer starts a new 60 seconds."
/>

## When names stop working

Almost everything you do on the internet starts with a name. So when your device cannot reach its resolver, it can feel as if the whole internet is down. Often it is not, and packets to IP addresses still travel as before. Only the step that turns names into addresses is broken.

<Quiz
  question="Your laptop can still reach 203.0.113.80, but no website opens by its name. What is most likely broken?"
  :choices="['The cable from your laptop', 'The lookup of names: the laptop cannot reach its resolver', 'The website’s server']"
  :answer="1"
  :why="['If the cable were broken, the laptop could not reach 203.0.113.80 either.', '', 'Every website fails, not just one, so the trouble is on your side, before any website is reached.']"
  explain="Packets still reach addresses, so the network works. What fails is the step before: turning each name into an address."
/>

## In short

- People use names, and networks use IP addresses. DNS turns a name into the address it stands for.
- You read a name from right to left: the ending such as `.id`, then the domain, then the name inside it.
- Your device asks a resolver. The resolver asks a root server, then the servers for the ending, then the servers for the domain.
- Every answer has a TTL: how many seconds it may be remembered. Until then, the resolver and your device answer from memory, so the second lookup is instant.
