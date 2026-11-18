---
title: Cables, light, and radio
description: A message crosses copper, glass fiber, or radio. Plug cables and optic modules into a switch, and see how far and how fast each kind of link goes.
---

# Cables, light, and radio

A message between two devices crosses one of three things. A copper cable carries electricity. A thin glass fiber carries light. Radio waves cross the air, and Wi-Fi is radio.

## How fast, and how far

Speed is counted in <Term means="Short for binary digit: a single 0 or 1. It is the smallest piece of data, and everything a link carries is made of bits.">bits</Term> a second. Network speeds are large, so they are usually counted in gigabits. One gigabit a second, written 1 Gbit/s, is a billion bits a second. People shorten it to **1G**. Switches show 10G, 25G, and 100G the same way.

A signal gets weaker the farther it goes, and electricity in copper also picks up noise. Past some distance, the device at the other end can no longer read the signal. So every kind of link has a limit.

## The copper cable

Most people call it a "LAN cable". Its real name is <Term means="A cable of thin copper wires twisted together in pairs. A LAN cable has four pairs and reaches up to 100 meters. UTP, unshielded twisted pair, is the common kind with no metal shield.">twisted pair</Term> cable. It has four pairs of thin copper wires inside one jacket, and each pair is twisted around itself. The twists keep the pairs from disturbing each other. The common kind has no metal shield around the pairs, so it is also called **UTP**, for unshielded twisted pair.

At each end is a clear plastic plug with eight metal contacts and a small clip, called <Term means="The plastic plug with eight contacts at each end of a LAN cable, and the square socket it clicks into. Its proper name is 8P8C, but everyone says RJ45.">RJ45</Term>. The socket on a laptop, on a home router, or on an office switch is an RJ45 socket.

LAN cables are sold in **categories**, written "Cat" and a number. A higher category is made more carefully and carries more:

| Category | 1 Gbit/s    | 10 Gbit/s    |
| -------- | ----------- | ------------ |
| Cat5e    | up to 100 m | not promised |
| Cat6     | up to 100 m | up to 55 m   |
| Cat6a    | up to 100 m | up to 100 m  |

No LAN cable reaches more than 100 meters, from the switch to the device. If a desk is farther than that from the switch, the building needs another switch closer to the desk.

## Fiber: light in glass

A <Term means="A cable with a thread of glass inside, thinner than a hair, that carries pulses of light. It reaches much farther than copper, and electrical noise does not disturb it.">fiber</Term> cable carries light instead of electricity. A laser or a small light at one end blinks very fast, and the other end reads the blinks as bits. Light in glass loses very little strength and picks up no electrical noise. So fiber reaches much farther than copper, from hundreds of meters to many kilometers. With the right equipment, it crosses countries and oceans. The thin cable from your internet provider into your home is often a fiber.

There are two kinds:

- **Multimode** fiber has a wider core, and light bounces along it on many paths. It is for short runs inside a room or a building, up to a few hundred meters.
- **Single-mode** fiber has a very narrow core, so light travels along one path and each pulse keeps its shape. It is for long runs, such as between two buildings or two cities.

A fiber link usually uses two fibers, one for each direction. Their plug is a small square plug called <Term means="A small plug for fiber, usually two side by side, one for each direction. It is the usual fiber plug on switches and optics.">LC</Term>.

## Optic modules and cages

A switch cannot take a fiber directly. It needs a part that turns its electrical signal into light, and back. That part is a small metal module called an <Term means="A small module that slides into a cage on a switch or router. It turns the electrical signal into light on a fiber, and back. Also called a transceiver.">optic</Term>, or a **transceiver**, because it both sends and receives. The optic slides into an empty slot on the switch, called a <Term means="An empty slot on a switch or router that takes an optic or a DAC. Its shape decides which modules fit.">cage</Term>. The fiber's LC plug goes into the front of the optic.

Cages and modules come in families. All of them are named after <Term means="Small form-factor pluggable: the family of small cages and modules for 1 to 25 Gbit/s. SFP carries 1 Gbit/s, SFP+ 10 Gbit/s, and SFP28 25 Gbit/s, and all three are the same size.">SFP</Term>, short for small form-factor pluggable:

| Name   | Speed      | Size                          |
| ------ | ---------- | ----------------------------- |
| SFP    | 1 Gbit/s   | small                         |
| SFP+   | 10 Gbit/s  | the same size as SFP          |
| SFP28  | 25 Gbit/s  | the same size as SFP          |
| QSFP+  | 40 Gbit/s  | wider: Q is for quad, four    |
| QSFP28 | 100 Gbit/s | wider, the same size as QSFP+ |

Older equipment may have **XFP**, an earlier and larger module for 10 Gbit/s.

Three rules decide whether a link works:

1. The module must fit the cage. Most cages also take the slower module of their own size, which then runs at its own speed.
2. Both ends must match. An optic works only with the same kind of optic at the far end, on the right kind of fiber.
3. The run must be within the optic's reach. Each optic is made for a distance, such as 300 meters on multimode or 10 kilometers on single-mode.

For a link of a few meters, to the next device in the same <Term means="A tall metal frame that holds switches and servers stacked on top of each other.">rack</Term>, there is a simpler part: a <Term means="Direct attach cable: a short copper cable with a module built onto each end. It plugs into two cages in place of two optics and a fiber, for a link inside one rack.">DAC</Term>, short for direct attach cable. It is a copper cable with a module built onto each end, so it goes straight into two cages. It reaches about 5 to 7 meters, depending on its speed.

Some switches have only RJ45 ports, like the small switch in a home router. Some have only cages, like many in a data center. An office switch often has both. It has RJ45 ports for the desks, and a few cages for a fast link to the next switch.

<TryIt title="Plug it in">

<PlugItIn />

</TryIt>

<Quiz
  question="A switch has SFP+ cages. You want to join it to another switch in the same rack, 2 meters away. What is the simplest thing to plug in?"
  :choices="['A Cat6 LAN cable', 'A DAC', 'A QSFP28 optic and a fiber']"
  :answer="1"
  :why="['A LAN cable has an RJ45 plug, and an SFP+ cage takes a module, not a plug.', '', 'A QSFP28 module is wider than an SFP+ cage, so it does not go in.']"
  explain="A DAC has a module built onto each end, so it goes straight into both cages. Its reach is well over 2 meters."
/>

## How far each one goes

<TryIt title="How far, how fast">

<HowFarHowFast />

</TryIt>

The pattern to remember:

- Copper for the last 100 meters to a desk.
- Multimode fiber inside a building.
- Single-mode fiber for anything farther.
- A DAC inside a rack.

<Quiz
  question="Two office buildings are 2 kilometers apart. Which link joins them?"
  :choices="['A Cat6a LAN cable', 'Multimode fiber', 'Single-mode fiber']"
  :answer="2"
  :why="['Every LAN cable stops at 100 meters.', 'Multimode fiber reaches a few hundred meters at most.', '']"
  explain="Single-mode fiber with the right optics reaches 10 kilometers or more, so 2 kilometers is easy for it."
/>

## Wired and wireless standards

All the cables, plugs, and optics in this lesson follow one standard, called <Term means="The standard for wired networks: the cables and plugs, the signals on them, the speeds, and how each message is laid out. Almost every wired network uses it.">Ethernet</Term>. It says what each kind of cable must carry, what the signals look like, and how a message is laid out. So a switch from one maker and a laptop from another understand each other. That is why the RJ45 socket on a laptop is often called its Ethernet port.

<Term means="The standard for networks over radio. It carries the same messages as Ethernet, so an access point can pass them between radio and cable.">Wi-Fi</Term> is a different standard, made to work with Ethernet. It carries the same messages over radio. An access point passes them between the radio and its cable to the switch. Radio is different from a cable in three ways:

- **It is shared.** Every device near an access point uses the same radio channel. Only one device can send at a time, so they take turns. On a cable, each device has its own way to the switch.
- **It is slower.** The speed printed on the box is the best case. Walls, distance, and other networks nearby bring it down.
- **It is short.** One access point reaches about 20 meters indoors, and less through walls. So offices put several access points on the ceiling, each with its own cable.

<Quiz
  question="Ten laptops sit near one access point. Why does each one get less speed than the number on the box?"
  :choices="['Wi-Fi gives each laptop one tenth of the speed on purpose', 'They share one radio channel and take turns, and the number on the box is the best case', 'Because the access point is joined to the switch by a LAN cable']"
  :answer="1"
  :why="['There is no fixed share. They take turns, and how much each one gets depends on how much the others send.', '', 'The cable to the switch is usually faster than the radio. The radio is where they share.']"
  explain="Only one device can send on a radio channel at a time, so the laptops take turns. Walls and distance lower the speed further."
/>

## The largest piece a link carries

A device cuts a long message into small pieces, called packets, as the [next lesson](/academy/beginner/packets) shows. Each link has a limit on how big one piece can be, called its <Term means="Maximum transmission unit: the largest single piece of data a link carries, in bytes. On ordinary Ethernet it is 1,500 bytes.">MTU</Term>, short for maximum transmission unit.

On ordinary Ethernet, the MTU is 1,500 <Term means="Eight bits together. One byte holds a number from 0 to 255, or one letter of plain English text.">bytes</Term>. One letter of plain text takes one byte, so that is about 1,500 letters.

Inside data centers, the links between a network's own switches and servers often carry larger pieces, of about 9,000 bytes. These are called **jumbo frames**. Fewer, larger pieces mean less work for the same message. Both ends of a link must agree on the size. Links to the internet stay at 1,500.

<Quiz
  question="A link has an MTU of 1,500 bytes. How is a message of 6,000 letters sent across it?"
  :choices="['In one piece, because the MTU only counts for the internet', 'Cut into pieces of at most about 1,500 letters each', 'It cannot be sent at all']"
  :answer="1"
  :why="['The MTU counts on every link, at home too. No piece larger than it crosses the link.', '', 'Long messages are sent all the time. They are cut into pieces that fit.']"
  explain="The MTU is the largest piece the link carries, so the message is cut into at least four pieces that each fit."
/>
