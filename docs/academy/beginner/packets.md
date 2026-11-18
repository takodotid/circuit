---
title: Messages in pieces
description: Data crosses a network in small pieces called packets. Cut a message into packets, send it, lose a few, and watch the receiver put it back together.
---

# Messages in pieces

A device never sends a message over a network in one go. It cuts the message into small pieces, called packets, and sends each piece on its own. The device at the other end puts the pieces back together. A short chat message may fit in one packet. A photo becomes a few thousand.

## Cutting a message into packets

Everything a device sends is <Term means="Anything a device stores or sends, such as the letters of a message, a photo, or a call.">data</Term>. Before data leaves your device, the device cuts it into pieces and puts each piece into a <Term means="A small piece of data with a label that says where it comes from, where it goes, and which piece it is. Everything on a network travels in packets.">packet</Term>. On most networks, one packet holds at most about 1,500 letters of plain text. That limit is the MTU from [Cables, light, and radio](/academy/beginner/cables).

Every packet has a label with three things on it:

| On the label | What it is for                                                               |
| ------------ | ---------------------------------------------------------------------------- |
| From         | The answer goes back to this device.                                         |
| To           | Every box on the way reads it to know where to pass the packet on.           |
| Its number   | The receiver puts the pieces back in order, and notices when one is missing. |

On a real network, "from" and "to" are addresses, the subject of the [next lesson](/academy/beginner/addresses). In the widget below, they are the names of the devices.

<TryIt title="Send a message in packets">

<PacketJourney />

</TryIt>

## Different ways, different order

There is often more than one way between two devices. Each box in the middle, like your home router, passes every packet on to the next box. When one way is busy, packets wait there in line. Packets that take a quiet way overtake them.

The packets of one message usually follow the same way, but they do not have to. If a link breaks or gets crowded, later packets may go another way and arrive before earlier ones.

The receiver does not mind the order. It puts each packet in its place by its number. When it has them all, the message is whole again.

<Quiz
  question="A message is cut into four packets. They arrive at the phone in the order 2, 1, 4, 3. What does the phone show?"
  :choices="['The message in the right order', 'The message jumbled, in the order 2, 1, 4, 3', 'Nothing, because packets that arrive out of order are thrown away']"
  :answer="0"
  :why="['', 'The phone does not keep the packets in the order they came. It reads the number on each one and puts it in its place.', 'Packets often arrive out of order, so the receiver expects it. It sorts them by number instead.']"
  explain="Each packet carries its number, so the phone puts packet 1 first, then 2, 3, and 4, whatever order they came in."
/>

## Lost packets are sent again

Sometimes a packet never arrives. A box in the middle that is too busy may have no room for one more packet, so it throws the packet away. Radio waves, which Wi-Fi uses, can be disturbed, and a damaged packet is thrown away too. Either way, the packet is lost.

The receiver notices from the numbers. If it has packets 1, 2, 4, and 5, then 3 is missing. In the widget, the phone sent a question mark back to the laptop. These are the steps:

1. The receiver sees a gap in the numbers.
2. It tells the sender which packet it is missing.
3. The sender sends that one packet again.
4. When the gap is filled, the receiver puts the message together.

This happens all the time when you open web pages, send messages, or download files, and you never notice it. Video calls and games work another way. They skip a lost piece, because waiting for it would be worse. [Ports and protocols](/academy/beginner/ports) shows how.

::: tip A packet sent again can be lost again
In the widget, a packet sent again always arrives. On a real network, the receiver asks again until the packet arrives, or the sender gives up.
:::

<Quiz
  question="A message is six packets long. The phone has received packets 1, 2, 3, 5, and 6. What happens next?"
  :choices="['The phone asks for packet 4, and only packet 4 is sent again', 'The laptop sends all six packets again', 'The phone shows the message with a piece missing']"
  :answer="0"
  :why="['', 'The other five arrived safely, so sending them again would only waste the link. The number on each packet tells the phone exactly which one is missing.', 'For a message or a file, a missing piece would spoil it. The phone asks for the missing packet instead.']"
  explain="The phone sees that number 4 is missing and asks for it. Only that one packet is sent again."
/>

## Why cut messages up at all?

Packets take work. Each one needs a label, and the receiver must put them back together. Networks use them anyway, for two reasons.

<TryIt title="Share one cable">

<SharedCable />

</TryIt>

**Packets let devices share a link fairly.** A cable carries one thing at a time. Without packets, the chat message waited until the whole video had crossed, even though it was tiny. With packets, the laptop and the phone took turns. The chat message got through almost at once, and the video was hardly slower. So a message from your phone still arrives quickly while someone else at home watches a film.

**Packets turn a big loss into a small one.** When noise damaged the video sent as one big piece, the whole video was sent again. When the video was sent as packets, only the damaged packet was sent again.

Packets have a cost too. Each packet carries its own label, so smaller packets mean more labels for the same message. Real networks use packets of up to about 1,500 letters. That is small enough to share a link, and large enough to keep the labels a small part of each packet.

<Quiz
  question="Why is a big file sent as many small packets instead of one big piece?"
  :choices="['So other devices can use the link in between, and a loss costs only one small piece', 'Because a cable can only carry one letter at a time', 'Because one big piece would always be slower, even on an empty network']"
  :answer="0"
  :why="['', 'A cable carries a whole packet of many letters at once. Packets are cut small so a link can be shared, not because a cable takes letters one by one.', 'On an empty network, one big piece would not be slower. Each packet even adds a label to carry. Packets help when the link is shared or something is lost.']"
  explain="Packets let devices take turns on a link. When one is lost, only that small piece is sent again."
/>

## In short

- Data crosses a network cut into small pieces called packets.
- Each packet has a label that says where it comes from, where it goes, and its number in the message.
- Packets may take different ways and arrive out of order. The receiver puts them back in order by number.
- The receiver notices a lost packet from the gap in the numbers, and only that packet is sent again.
- Packets let many devices share one link, and they turn a big loss into a small one.
