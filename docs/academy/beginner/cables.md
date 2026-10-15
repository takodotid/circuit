---
title: Cables, light and radio
description: A message crosses copper, glass fibre or radio. Plug cables and optic modules into a switch, and see how far and how fast each kind of link goes.
---

# Cables, light and radio

A message between two devices crosses one of three things: a copper cable that carries electricity, a thin glass fibre that carries light, or radio waves through the air. Copper is simple, but reaches only 100 metres. Fibre reaches kilometres, at the highest speeds. Radio, which is what Wi-Fi is, needs no cable at all, but it is slower and shared.

This lesson shows you what each one looks like, what plugs into what, and how far and how fast each one goes.

## How fast, and how far

Every link has two numbers: how fast it is and how far it reaches.

Speed is counted in <Term means="The smallest thing a link carries: a single 0 or 1. A later lesson, Counting like a computer, shows how bits make numbers and letters.">bits</Term> a second. Network speeds are large, so they are often counted in gigabits: 1 Gbit/s is a thousand million bits a second. People shorten it to **1G**, and you will see 10G, 25G and 100G on switches the same way.

Distance matters because a signal gets weaker the further it goes. Electricity in copper also picks up noise on the way. Past some distance, the device at the other end can no longer read it, so every kind of link has a limit.

## The LAN cable: copper

What most people call a "LAN cable" is a <Term means="A cable of thin copper wires twisted together in pairs. It is what is inside every LAN cable.">twisted pair</Term> cable: four pairs of thin copper wires inside one jacket, each pair twisted around itself. The twists keep the pairs from disturbing each other. Because the common kind has no metal shield around the pairs, it is also called **UTP**, for unshielded twisted pair.

At each end is a clear plastic plug with eight metal contacts and a small clip, called <Term means="The clear plastic plug with eight contacts at the end of a LAN cable, and the square socket it clicks into. Its proper name is 8P8C, but everyone says RJ45.">RJ45</Term>. The socket on a laptop, on the back of a home router or on an office switch is an RJ45 socket.

LAN cables are sold in **categories**, written Cat and a number. A higher category is made more carefully and carries more:

| Category | 1 Gbit/s    | 10 Gbit/s    |
| -------- | ----------- | ------------ |
| Cat5e    | up to 100 m | not promised |
| Cat6     | up to 100 m | up to 55 m   |
| Cat6a    | up to 100 m | up to 100 m  |

The 100 metres is the most any LAN cable reaches, for the whole run from the switch to the device. A building with desks further than that from the switch puts another switch closer to them.

## Fibre: light in glass

A <Term means="A cable with a thread of glass inside, thinner than a hair, that carries pulses of light instead of electricity. It reaches much further than copper and is not disturbed by electrical noise.">fibre</Term> cable carries light instead of electricity. A laser or a small light at one end blinks very fast, and the other end reads the blinks as bits. Light in glass loses very little strength and picks up no electrical noise, so fibre reaches far further than copper: hundreds of metres to many kilometres, and on the right equipment, across countries and under oceans. The thin cable from your internet provider into your home is often a fibre.

There are two kinds:

- **Multimode** fibre has a wider core, and light bounces along it on many paths. It is for short runs, inside a room or a building, up to a few hundred metres.
- **Single-mode** fibre has a very narrow core, so light travels along one path and each pulse keeps its shape. It is for long runs, between buildings and between cities.

A fibre link usually uses two fibres, one for each direction. Their plug is not RJ45: it is a small square plug called <Term means="A small plug for fibre, usually in pairs side by side, one fibre for each direction. It is the usual fibre plug on switches and optic modules.">LC</Term>, often two side by side in one clip.

## Optic modules and cages

A switch cannot plug a fibre straight into itself. It needs a part that turns its electrical signal into light and back. That part is a small metal module called an <Term means="A small module that slides into a cage on a switch or router, and turns its electrical signal into light on a fibre, and back. Also called a transceiver.">optic</Term>, or a **transceiver**, because it both sends and receives. It slides into an empty square slot on the switch, called a <Term means="An empty metal slot on a switch or router that takes an optic module or a DAC. Its shape decides which modules fit.">cage</Term>, and the fibre's LC plug goes into the front of the optic.

Cages and modules come in families, all named from <Term means="Small form-factor pluggable: the family of small modules and cages for 1 to 25 Gbit/s, SFP, SFP+ and SFP28. QSFP, quad SFP, is the wider family for 40 and 100 Gbit/s.">SFP</Term>, short for small form-factor pluggable:

| Name   | Speed      | Size                          |
| ------ | ---------- | ----------------------------- |
| SFP    | 1 Gbit/s   | small                         |
| SFP+   | 10 Gbit/s  | the same size as SFP          |
| SFP28  | 25 Gbit/s  | the same size as SFP          |
| QSFP+  | 40 Gbit/s  | wider: Q is for quad, four    |
| QSFP28 | 100 Gbit/s | wider, the same size as QSFP+ |

On older equipment you may also find **XFP**, an earlier and larger module for 10 Gbit/s.

Three rules decide whether a link works:

1. The module must fit the cage. SFP, SFP+ and SFP28 are one size; QSFP+ and QSFP28 are wider. Most cages also take the slower module of their own size, which then runs at its own speed.
2. Both ends must match. An optic only understands an optic of the same kind at the far end, on the right kind of fibre.
3. The run must be within the optic's reach. An optic is made for a distance, such as 300 metres on multimode or 10 kilometres on single mode.

For a link of a few metres, to the next device in the same <Term means="A tall metal frame that holds switches and servers stacked one above another, in an office's network room or a data centre.">rack</Term>, there is a shortcut: a <Term means="Direct attach cable: a short copper cable with a module built onto each end. It plugs into two cages instead of two optics and a fibre, for a link inside one rack.">DAC</Term>, short for direct attach cable. It is a copper cable with a module already built onto each end, so it goes straight into two cages. It reaches up to about 5 to 7 metres, depending on its speed.

Some switches have only RJ45 ports, like the small switch in a home router. Some have only cages, like many in a data centre. An office switch often has both: RJ45 ports for the desks, and a few cages for a fast link to the next switch.

<TryIt title="Plug it in">

Take a cable or a module from the tray, then pick a port. Try each one in a port it fits, and in one it does not.

<PlugItIn />

</TryIt>

Two things are worth seeing again. The LAN cable fits only an RJ45 port, and a module fits only a cage of its own size. And the SFP28 optic slides into an SFP+ cage, because they are the same size, but usually no link comes up: fitting is not the same as working.

<Quiz
  question="A switch has SFP+ cages. You want to join it to another switch in the same rack, 2 metres away. What is the simplest thing to plug in?"
  :choices="['A Cat6 LAN cable', 'A DAC', 'A QSFP28 optic and a fibre']"
  :answer="1"
  :why="['A LAN cable has an RJ45 plug, and an SFP+ cage takes a module, not a plug.', '', 'A QSFP28 module is wider than an SFP+ cage, so it does not go in.']"
  explain="A DAC has a module built onto each end, so it goes straight into both cages, and 2 metres is well within its reach."
/>

## How far each one goes

Each kind of link has its own reach, and that reach depends on the speed too. Pick a distance and a speed, and see which links work.

<TryIt title="How far, how fast">

Pick a distance and a speed. Start at a desk at 1 Gbit/s, then move further away, and then go faster.

<HowFarHowFast />

</TryIt>

At a desk, almost anything works. Across a floor, copper still works, but at 10 Gbit/s only the better Cat6a carries the full distance. Between buildings, copper and multimode fibre are both too short, and single-mode fibre takes over. Across a city, only optics made for long distances still reach.

The pattern is the one to remember: copper for the last 100 metres to a desk, multimode fibre inside a building, single-mode fibre for anything further, and a DAC inside a rack.

<Quiz
  question="Two office buildings are 2 kilometres apart. Which link joins them?"
  :choices="['A Cat6a LAN cable', 'Multimode fibre', 'Single-mode fibre']"
  :answer="2"
  :why="['Every LAN cable stops at 100 metres.', 'Multimode fibre reaches a few hundred metres at most.', '']"
  explain="Single-mode fibre with the right optics reaches 10 kilometres or more, so 2 kilometres is easy for it."
/>

## Ethernet and Wi-Fi

All the cables, plugs and optics in this lesson follow one standard, called <Term means="The standard for wired networks: the cables and plugs, the signals on them, the speeds, and how each message is laid out. Almost every wired network uses it.">Ethernet</Term>. It says what each kind of cable must carry, how the signals look, and how a message is laid out, so that a switch from one maker and a laptop from another understand each other. That is why the RJ45 socket on a laptop is often called its Ethernet port.

<Term means="The standard for networks over radio. It is made to work with Ethernet: it carries the same messages, so an access point can pass them between radio and cable.">Wi-Fi</Term> is a different standard, made to work hand in hand with Ethernet. It carries the same messages, over radio instead of a cable, and an access point passes them between the radio and the cable to the switch. Radio changes three things:

- **It is shared.** Every device near one access point uses the same radio channel, and only one can send at a time, so they take turns. A cable gives each device its own way to the switch.
- **It is slower.** The speeds printed on the box are the best case. Walls, distance and other networks nearby bring them down.
- **It is short.** One access point reaches about 20 metres indoors, less through walls. This is why offices put several on the ceiling, each with its own cable.

<Quiz
  question="Ten laptops sit near one access point. Why does each one get less speed than the number on the box?"
  :choices="['Wi-Fi gives each laptop one tenth of the speed on purpose', 'They share one radio channel and take turns, and the number on the box is the best case', 'Because the access point is joined to the switch by a LAN cable']"
  :answer="1"
  :why="['There is no fixed share. They take turns, and how much each gets depends on how much the others send.', '', 'The cable to the switch is usually faster than the radio. The radio is where they share.']"
  explain="Only one device can send on a radio channel at a time, so the laptops take turns, and walls and distance lower the speed further."
/>

## The largest piece a link carries

In the [next lesson](/academy/beginner/packets), you see that a device never sends a long message in one go: it cuts it into small pieces and sends each one on its own. How big can one piece be? Each link has a limit, called its <Term means="Maximum transmission unit: the largest piece of a message a link carries in one go. On ordinary Ethernet it is 1,500 bytes.">MTU</Term>, short for maximum transmission unit.

On ordinary Ethernet, the MTU is 1,500 <Term means="A group of eight bits. One letter of plain text takes one byte, so 1,500 bytes is about 1,500 letters.">bytes</Term>. One letter of plain text takes one byte, so that is about 1,500 letters, and you will meet that number again in the next lesson.

Inside data centres, the links between a network's own switches and servers are often set to carry much larger pieces, of about 9,000 bytes, called <Term means="A piece larger than the usual 1,500 bytes, often about 9,000, used on links inside a data centre or between a network's own devices.">jumbo frames</Term>. Fewer, larger pieces mean less work for the same message. Both ends of a link must agree on the size, and links out to the internet stay at 1,500.

<Quiz
  question="A link has an MTU of 1,500 bytes. How is a message of 6,000 letters sent across it?"
  :choices="['In one piece, because the MTU only counts for the internet', 'Cut into pieces of at most about 1,500 letters each', 'It cannot be sent at all']"
  :answer="1"
  :why="['The MTU counts on every link, at home too. No piece larger than it crosses the link.', '', 'Long messages are sent all the time. They are cut into pieces that fit.']"
  explain="The MTU is the largest piece the link carries, so the message is cut into at least four pieces that each fit."
/>

## In short

- A LAN cable is a copper twisted pair cable with RJ45 plugs. Cat5e and Cat6 carry 1 Gbit/s up to 100 metres, and Cat6a carries 10 Gbit/s that far.
- Fibre carries light: multimode inside a building, single mode for kilometres. Its plug is LC.
- Fast ports are cages that take optic modules: SFP 1G, SFP+ 10G, SFP28 25G, QSFP+ 40G, QSFP28 100G. The module must fit, both ends must match, and the run must be within reach. A DAC joins two cages in one rack.
- Ethernet is the standard all of these follow. Wi-Fi carries the same messages over radio, shared, slower and shorter.
- The MTU is the largest piece a link carries: 1,500 bytes on ordinary Ethernet, about 9,000 with jumbo frames inside data centres.
