---
title: Messages in pieces
description: Data crosses a network in small pieces called packets. Cut a message into packets, send it, lose a few, and watch the receiver put it back together.
---

# Messages in pieces

When a device sends something over a network, it does not send it in one go. It cuts it into small pieces called packets, sends each piece on its own, and the device at the other end puts the pieces back together.

A short chat message may fit in one packet. A photo becomes a few thousand. Each packet carries a small label that says where it comes from, where it is going, and its number in the message, so it can find its way and take its place again at the end.

## Cutting a message into packets

Everything a device sends is <Term means="Anything a device stores or sends: the letters of a message, the dots of a photo, the sound of a call. To a network it is all the same: something to carry.">data</Term>. Before data leaves your device, it is cut into pieces of a set size, and each piece is put into a <Term means="A small piece of data with a label on it that says where it comes from, where it goes and which piece it is. Everything on a network travels in packets.">packet</Term>. On most networks, one packet holds at most about 1,500 letters of plain text.

Every packet gets a label with three things on it:

| On the label | What it is for                                                                    |
| ------------ | --------------------------------------------------------------------------------- |
| From         | So the answer knows where to go back to.                                          |
| To           | So every box on the way knows where to pass the packet on.                        |
| Its number   | So the receiver can put the pieces back in order, and notice when one is missing. |

In a real network, "from" and "to" are addresses, which is what the [next lesson](/academy/beginner/addresses) is about. Here they are just the names of the devices.

<TryIt title="Send a message in packets">

Send the message once as it is. Then change the packet size, or turn off losing packets, and send it again. Watch the order the packets arrive in.

<PacketJourney />

</TryIt>

Look at the cards before you send: every packet has the same "from" and "to", and its own number. Then look at what the phone received. The packets left the laptop in order, 1, 2, 3, but they rarely arrived that way.

## Different ways, different order

Between your device and the one you are talking to, there is often more than one way through. Each box in the middle, like your home router, passes every packet on to the next box. When one way is busy, packets wait there in line, and packets that went the quiet way overtake them. That is what happened on the busy way in the drawing.

The packets of one message usually follow the same way, but they do not have to. If a link breaks or gets crowded, later packets may be sent another way, and arrive before earlier ones.

The receiver does not mind. It does not care what order the packets come in, because each one carries its number. It puts each packet in its place by number, and when it has them all, the message is whole again.

<Quiz
  question="A message is cut into four packets. They arrive at the phone in the order 2, 1, 4, 3. What does the phone show?"
  :choices="['The message in the right order', 'The message jumbled, in the order 2, 1, 4, 3', 'Nothing, because packets that arrive out of order are thrown away']"
  :answer="0"
  :why="['', 'The phone does not keep the packets in the order they came. It reads the number on each one and puts it in its place.', 'Packets arriving out of order is normal, so the receiver expects it. It sorts them by number instead.']"
  explain="Each packet carries its number, so the phone puts packet 1 first, then 2, 3 and 4, whatever order they came in."
/>

## Lost packets are sent again

Sometimes a packet never arrives. A box in the middle that is too busy may have no room left to hold one more packet, so it throws it away. Radio waves, which Wi-Fi uses, can be disturbed, and a packet that arrives damaged is thrown away too. Either way, the packet is lost.

The receiver notices from the numbers. If it has packets 1, 2, 4 and 5, then 3 is missing. In the widget, that is the question mark that went back from the phone:

1. The receiver sees a gap in the numbers.
2. It tells the sender which packet it is missing.
3. The sender sends that one packet again.
4. When the gap is filled, the receiver puts the message together.

For most of what you do, such as opening web pages, sending messages and downloading files, this happens all the time without you noticing. A [later lesson](/academy/beginner/ports) shows the other way of sending, used for video calls and games, where a lost piece is simply skipped because waiting for it would be worse.

::: tip In this widget, a packet sent again always arrives
On a real network, a packet sent again can be lost again. Then the receiver asks again, until it arrives or the sender gives up.
:::

<Quiz
  question="A message is six packets long. The phone has received packets 1, 2, 3, 5 and 6. What happens next?"
  :choices="['The phone asks for packet 4, and only packet 4 is sent again', 'The laptop sends all six packets again', 'The phone shows the message with a piece missing']"
  :answer="0"
  :why="['', 'The other five arrived safely, so sending them again would only waste the link. The number on each packet tells the phone exactly which one is missing.', 'For a message or a file, a missing piece would spoil it. The phone asks for the missing packet instead.']"
  explain="The phone sees that number 4 is missing, asks for it, and only that one packet is sent again."
/>

## Why cut messages up at all?

Cutting a message into packets, labelling each one and putting them back together sounds like a lot of work. Networks do it for two reasons, and the next widget shows both.

<TryIt title="Share one cable">

A laptop is sending a video and a phone a short chat message, over the one cable from the home router to the internet. Send both with packets off, then with packets on. Then turn on the noise and try both again.

<SharedCable />

</TryIt>

**Packets let devices share a link fairly.** A cable carries one thing at a time. Without packets, the chat message had to wait until the whole video had crossed, even though it was tiny. With packets, the laptop and the phone took turns, so the chat message got through almost at once and the video was hardly slower. This is why a message from your phone still arrives quickly while someone else at home is watching a film.

**Packets turn a big loss into a small one.** When noise damaged the video sent as one big piece, the whole video had to be sent again. When it was sent as packets, only the one damaged packet was sent again.

There is a cost too: every packet carries its own label, so smaller packets mean more labels to carry for the same message. You saw this in the first widget when you picked the small size: more packets, more numbers. Real networks settled on packets of up to about 1,500 letters as a fair middle.

<Quiz
  question="Why is a big file sent as many small packets instead of one big piece?"
  :choices="['So other devices can use the link in between, and a loss costs only one small piece', 'Because a cable can only carry one letter at a time', 'Because one big piece would always be slower, even on an empty network']"
  :answer="0"
  :why="['', 'A cable carries a whole packet of many letters at once. Packets are cut small so a link can be shared, not because a cable takes letters one by one.', 'On an empty network one big piece would not be slower. Each packet even adds a label to carry. Packets pay off when the link is shared or something is lost.']"
  explain="Packets let devices take turns on a link, and when one is lost, only that small piece is sent again."
/>

## In short

- Data travels across a network cut into small pieces called packets.
- Each packet has a label that says where it comes from, where it goes, and its number in the message.
- Packets may take different ways and arrive out of order; the receiver puts them back in order by number.
- A lost packet is noticed from the gap in the numbers and sent again, on its own.
- Packets let many devices share one link, and turn a loss into a small one.
