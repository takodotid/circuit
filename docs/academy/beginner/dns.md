---
title: "Names and numbers: DNS"
description: DNS turns a name like circuit.tako.id into an IP address. Step through a lookup from the root down, and see why the second one is instant.
---

# Names and numbers: DNS

People use names, such as `circuit.tako.id`. Networks deliver packets only to IP addresses, such as `203.0.113.80`. <Term means="Domain Name System: the system that turns a name like circuit.tako.id into the IP address it stands for.">DNS</Term>, the Domain Name System, is what turns the name into the address.

Your device asks one helper, its resolver. The resolver finds the answer by asking a chain of servers, from the top of the name down. Your device and the resolver both remember the answer for a while, so the next time is instant.

::: info The addresses in this lesson
`203.0.113.80` and the other addresses here are example addresses, kept for teaching. The real address of a name can be different.
:::

## Why names

A name is easier to remember than four numbers, but that is not the only reason. A website can move to another server with another address. If everyone used the address, everyone would have to learn the new one. With a name, the owner changes what the name points to, and nobody else notices.

It works like the contacts on your phone: you tap a name, and the phone dials the number behind it. The picture stops being true in one place. Your contacts are yours alone, kept on your phone. DNS is one book shared by the whole internet, and no single computer has all of it: it is split over many servers, and each has its own part.

## Reading a name

A name is read from right to left, from the most general part to the most exact:

| Part              | What it is                                                                                                                                                                                                |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`              | The top of the name. `.id` is the ending for Indonesia; others are `.com`, `.org` or `.uk`.                                                                                                               |
| `tako.id`         | A <Term means="A name someone has registered, such as tako.id. Its owner decides which names exist under it.">domain</Term>: a name someone has registered. Its owner decides which names exist under it. |
| `circuit.tako.id` | One name inside that domain, chosen by the domain's owner.                                                                                                                                                |

Above all of these is the root, the starting point of every name on the internet. Each level knows only the level just under it: the root knows who looks after `.id`, the `.id` servers know who looks after `tako.id`, and the `tako.id` servers know the names inside it.

## A lookup, step by step

Your device does not ask all of these servers itself. It asks a <Term means="A server that looks up names for you: it asks the other DNS servers, and remembers their answers.">resolver</Term>, a server that does the asking for it. Your internet provider usually runs one, and your device learns its address when it joins a network, together with its own address and gateway. The resolver knows where the root servers are from the start: there is a small, fixed set of them, each copied to many places around the world.

<TryIt title="Look up circuit.tako.id">

Step through the lookup with **Next step**. Then pick who already remembers the answer, and step through again. Watch the count of questions.

<DnsLookup />

</TryIt>

When nobody remembers the name, the lookup goes like this:

1. The laptop asks the resolver: what is the address of `circuit.tako.id`?
2. The resolver asks a root server. The root does not know the name, but answers: ask the servers for `.id`, here are their addresses.
3. The resolver asks a server for `.id`, which answers: ask the servers for `tako.id`, here are their addresses.
4. The resolver asks a server for `tako.id`, which knows: `circuit.tako.id` is `203.0.113.80`.
5. The resolver passes the answer back to the laptop.

Each server knows only its own part and where to go next, much like each router knows only the next hop. That is how the work is shared out: no server has to know every name in the world.

<Quiz
  question="Which server has the address of circuit.tako.id itself?"
  :choices="['A root server', 'A server for .id', 'A server for tako.id', 'Your laptop']"
  :answer="2"
  :why="['The root only knows who looks after each ending, such as .id. It points the resolver onwards.', 'The .id servers only know who looks after each domain under .id, such as tako.id.', '', 'Your laptop only remembers an answer after it has asked for it.']"
  explain="The servers for tako.id have the domain’s own list of names. The root and the .id servers only point the resolver closer to them."
/>

## Remembering answers

Four questions for every name would be slow, and the root and `.id` servers would be asked the same things all day. So every answer comes with a number of seconds it may be remembered for, called its <Term means="Time to live: in DNS, the number of seconds an answer may be remembered before it must be asked for again.">TTL</Term>, or time to live. The resolver and your laptop each keep the answer until that time runs out, and answer from memory until then.

::: tip The same three letters, a different counter
In [Routers and the gateway](/academy/beginner/routers), TTL was a number on a packet that each router lowers by one. In DNS it is a number of seconds on an answer. Both say how long something may live, which is why they share the name.
:::

In the lookup above, the second and third choices show the difference: when the resolver remembers the name, the laptop's one question is answered at once, and when the laptop remembers it, no question goes out at all. Here you can watch the time run out.

<TryIt title="Watch the resolver remember and forget">

Look up a name, look it up again, then move the clock forward. The times shown are rough examples: a real lookup takes from a few milliseconds to a few hundred.

<DnsMemory />

</TryIt>

The first lookup of a name took four questions. Every lookup after it, until its TTL ran out, took one. Remembering has one cost: when a website moves to a new address, resolvers that still remember the old answer keep giving it out until its TTL runs out. That is why a change to a name can take a while to reach everyone, and why people often lower a TTL a day before they move a site.

<Quiz
  question="The answer for shop.example.com came with a TTL of 60. Two minutes later, someone asks the same resolver for that name again. What does the resolver do?"
  :choices="['Answers from memory at once', 'Asks the servers again for a fresh answer', 'Says the name does not exist']"
  :answer="1"
  :why="['The answer could be kept for 60 seconds, and two minutes is 120. It has been forgotten.', '', 'The name still exists. The resolver only forgot the answer, so it looks it up again.']"
  explain="After 60 seconds the resolver forgets the answer, so the next question is looked up again. The answer then starts a new 60 seconds."
/>

## When names stop working

Almost everything you do on the internet starts with a name, so when the resolver cannot be reached, it can feel as if the whole internet is down. Often it is not: packets to IP addresses still travel as before. Only the step that turns names into addresses is broken.

<Quiz
  question="Your laptop can still reach 203.0.113.80, but no website opens by its name. What is most likely broken?"
  :choices="['The cable from your laptop', 'The lookup of names: the laptop cannot reach its resolver', 'The website’s server']"
  :answer="1"
  :why="['If the cable were broken, the laptop could not reach 203.0.113.80 either.', '', 'Every website fails, not just one, so the trouble is on your side, before any website is reached.']"
  explain="Packets still reach addresses, so the network works. What fails is the step before: turning each name into an address."
/>

## In short

- People use names; networks use IP addresses. DNS turns a name into the address it stands for.
- A name is read from right to left: the ending such as `.id`, then the domain, then the name inside it.
- Your device asks a resolver, which asks a root server, then the servers for the ending, then the servers for the domain.
- Every answer has a TTL: how many seconds it may be remembered. Until then the resolver and your device answer from memory, which is why the second lookup is instant.
