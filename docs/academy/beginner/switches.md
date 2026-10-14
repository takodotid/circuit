---
title: Switches
description: A switch passes each message only to the device it is for. Send frames between devices, and watch a switch learn where each one is.
---

# Switches

A switch is the box that joins the devices in one place, such as the computers on one floor of an office. Every device has its own cable to the switch, and the switch passes each message only to the device it is for.

Nobody tells the switch where the devices are. It works that out by itself, from the messages that pass through it, and this lesson shows you how.

## Ports and frames

A switch has a row of sockets called <Term means="A socket on a switch or router for one cable. Ports are numbered, so you can say which cable is which.">ports</Term>, numbered 1, 2, 3 and so on. Each device's cable plugs into one port. The few sockets on the back of a home router are a small switch built into the box.

::: tip One word, two meanings
"Port" is also the name of something quite different: a number that picks one program on a computer. You meet that kind in [Ports and protocols](/academy/beginner/ports). In this lesson, a port is always a socket.
:::

Inside one local network, messages travel in <Term means="A message on the local network: a packet wrapped with the hardware address of the device it is for and the one that sent it.">frames</Term>. A frame is a packet in an outer envelope, and the envelope has two of the hardware addresses you met in [Addresses](/academy/beginner/addresses):

- **To**: the hardware address of the device the frame is for.
- **From**: the hardware address of the device that sent it.

A switch reads only these two addresses. It does not look at the IP addresses inside, and it does not change the frame.

Frames on a cable follow a standard called <Term means="The standard for frames on a cable: how they are laid out, with their hardware addresses, and how they are sent as signals. Almost every wired network uses it.">Ethernet</Term>, the one almost every wired network uses, which is why the socket on a laptop is often called its Ethernet port. Wi-Fi sends the same kind of frame over radio instead.

## How a switch learns

When a switch is turned on, it knows nothing about the devices plugged into it. Its <Term means="The list a switch keeps of which hardware address is behind which of its ports. It is also called the MAC address table.">address table</Term>, the list of which device is behind which port, is empty. Send a few frames and see what it does with them.

<TryIt title="Teach a switch where everyone is">

Send a frame from one device to another and watch which ports it goes out of, and what appears in the table. Then send one back the other way. The small numbered squares are the switch's ports.

<SwitchLearning />

</TryIt>

The first frame went out of four ports. The reply went out of one. Each time a frame arrives, the switch does the same four things:

1. It reads the frame's **From** address, and writes in its table that this address is behind the port the frame came in on.
2. It looks for the frame's **To** address in the same table.
3. If it finds it, it sends the frame out of that one port only.
4. If it does not, it sends a copy out of every port except the one the frame came in on. This is called <Term means="Sending a copy of a frame out of every port except the one it came in on, because the switch does not know yet where the receiver is.">flooding</Term>. A device that gets a copy that is not addressed to it simply ignores it.

Notice what the switch learns from: the sender, never the receiver. A frame **to** the printer teaches the switch nothing about the printer. Only a frame **from** the printer does. That is why the reply went out of one port: the first frame had already taught the switch where the laptop was.

Flooding sounds wasteful, but it lasts only a moment. Devices that talk to each other answer each other, and every answer teaches the switch one more row. On a busy network the table fills within seconds, and after that almost every frame goes out of exactly one port.

<Quiz
  question="A switch has just been turned on, and its table is empty. The laptop on port 1 sends a frame to the printer on port 3. Which ports does the frame go out of?"
  :choices="['Port 3 only', 'Every port except port 1', 'Every port, port 1 too', 'None: the switch drops it']"
  :answer="1"
  :why="['You know the printer is behind port 3, but the switch does not: no frame from the printer has passed through it yet.', '', 'A switch never sends a frame back out of the port it came in on. The laptop already has it.', 'A switch does not drop a frame because it does not know the receiver. It floods it instead.']"
  explain="The table is empty, so the switch floods the frame out of every other port. On the way it learns one thing: the laptop is behind port 1."
/>

## Forgetting, and moving devices

A switch does not keep a row forever. If no frame comes from an address for a while, often five minutes, the switch removes that row. When the device talks again, the switch learns it again.

Forgetting is useful. Unplug the laptop and plug it into another port, or carry it to a desk on another switch, and the first frame it sends from the new place updates the table. Frames for the laptop then follow it there.

## Broadcasts: a frame for everyone

Sometimes a device needs to ask every device on the network at once, because it does not know which one to ask. For that it sends a <Term means="A frame for every device on the local network. Its To address is ff:ff:ff:ff:ff:ff.">broadcast</Term>: a frame whose **To** address is `ff:ff:ff:ff:ff:ff`, the hardware address where every bit is 1. It means "everyone".

A switch sends a broadcast out of every port except the one it came in on, as it does when it floods. The difference is at the other end: every device keeps a broadcast and reads it, because it is addressed to all of them. Choose **Everyone (broadcast)** in the widget above to see it.

A common broadcast is a question such as "which of you has the IP address 192.168.1.30?". The device with that address answers with its hardware address, and from then on the two can send each other frames. This question and answer has a name, <Term means="Address resolution protocol: how a device finds the hardware address that belongs to an IP address on its own network, by asking everyone with a broadcast.">ARP</Term>, and you will try it in the next lesson.

<Quiz
  question="Which frames does a switch send out of every port except the one they came in on?"
  :choices="['Every frame, always', 'Frames for an address it has not learned yet, and broadcasts', 'Only broadcasts', 'Only frames from a device it has not seen before']"
  :answer="1"
  :why="['Once a switch has learned where the receiver is, it uses one port only.', '', 'An unknown receiver is flooded too: the switch has no other way to reach it.', 'A new sender is written into the table, but where the frame goes depends on its receiver, not its sender.']"
  explain="A switch floods when it does not know where the receiver is, and copies a broadcast to everyone because it is for everyone. Everything else goes out of one port."
/>

## Be the switch

Now you make the decisions. Each round shows a frame arriving on a port, and the switch's table just before it arrives. Pick the ports the frame goes out of.

<TryIt title="Be the switch">

Read the frame's To address, then look for it in the table.

<SwitchPredict />

</TryIt>

## One local network

Everything a broadcast can reach is one <Term means="Local area network: the devices in one place, joined by switches, which can reach each other directly with frames.">local network</Term>, also called a LAN, short for local area network. The devices in your home are one LAN. So are the computers on one floor of an office.

A LAN can be bigger than one switch. Plug one switch into a port of another, and frames pass between them: each switch writes in its table that every device on the other switch is behind the one port that joins them. Both switches and every device on them are still one LAN, and a broadcast from any device reaches all of it.

What a switch cannot do is send a frame to a different network, such as your internet provider's. A hardware address only means something inside its own local network, and hardware addresses are all a switch reads. Joining one network to another is the job of a router, in the next lesson.

<Quiz
  question="An office has two switches joined by one cable, with ten computers on each. One computer sends a broadcast. Who gets it?"
  :choices="['Only the other nine computers on the same switch', 'All nineteen other computers', 'Only the second switch']"
  :answer="1"
  :why="['The first switch sends the broadcast out of every other port, and one of those is the cable to the second switch, which does the same.', '', 'The second switch passes it on to its own ports, just as the first one did.']"
  explain="The two switches and their twenty computers are one local network, and a broadcast reaches all of it."
/>

::: info Before switches
Older networks used a box called a hub, which copied every message out of every port, every time. Every device saw every message, and only one device could send at a time. Switches replaced hubs because they learn, and send each frame only where it needs to go.
:::

## In short

- A switch joins the devices in one place, one cable to each port.
- On the local network, messages travel in frames, addressed by hardware address.
- A switch learns which address is behind which port from the sender of each frame, and keeps it in its address table.
- A frame for an address the switch knows goes out of one port. A frame for an address it does not know is flooded, and a broadcast goes to everyone.
- Everything a broadcast can reach is one local network, a LAN.
