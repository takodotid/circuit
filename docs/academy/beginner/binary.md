---
title: Counting like a computer
description: Computers count with two digits, 0 and 1. Flip eight switches to read and write every number from 0 to 255, and see why IP addresses stop at 255.
---

# Counting like a computer

Computers count with only two digits, 0 and 1. Each of these digits is called a bit, and eight bits together are a byte. A byte can hold any whole number from 0 to 255, and no more.

That is why each of the four numbers in an IP address such as `192.168.1.23` is somewhere between 0 and 255: each one is a byte.

## Counting with ten digits

You already know one way of counting so well that you never think about it. It uses ten digits, 0 to 9. When you count past 9, you run out of digits, so you write a 1 in the next place to the left and start again from 0: that is 10, one ten and no ones.

Each place is worth ten times the place to its right:

| Hundreds | Tens | Ones | The number         |
| :------: | :--: | :--: | ------------------ |
|    2     |  5   |  5   | 200 + 50 + 5 = 255 |
|    0     |  1   |  0   | 10 + 0 = 10        |

Counting like a computer is the same idea, with fewer digits.

## Counting with two digits

Inside a computer, everything is kept in tiny switches that are either on or off, and everything sent over a cable or through the air is, in the end, a long row of offs and ons. So computers count with two digits only: 0 for off and 1 for on. A digit that can only be 0 or 1 is a <Term means="Short for binary digit: one digit that is either 0 or 1, like one switch that is either off or on. The smallest piece of data there is.">bit</Term>, and counting with two digits is called **binary**.

The trick is the same as with ten digits: when you run out of digits, you carry one to the next place. With only 0 and 1, you run out after every second step. And each place is worth twice the place to its right, not ten times.

<TryIt title="Eight switches">

Each switch is worth the number above it when it is on. Flip some on and see what they add up to. Then press Count up on its own and watch which switches move.

<BitSwitches tools />

</TryIt>

When the switches counted up on their own, the one on the right flipped every time. The one next to it flipped half as often, and each switch to the left half as often again. Every time a switch went from on to off, it turned on the switch to its left: that is carrying one, just like 9 becoming 10. And when all eight were on, at 255, there was nowhere left to carry to.

### Reading a number in bits

To read bits, add up the values of the switches that are on. Here is `10101000`:

| 128 | 64  | 32  | 16  |  8  |  4  |  2  |  1  |
| :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
|  1  |  0  |  1  |  0  |  1  |  0  |  0  |  0  |

The switches worth 128, 32 and 8 are on, so it is 128 + 32 + 8 = 168.

<Quiz
  question="What number is 00000110?"
  :choices="['6', '110', '3']"
  :answer="0"
  :why="['', 'It looks like one hundred and ten, but these places are worth 4 and 2, not 100 and 10.', 'Look at which switches are on: the ones worth 4 and 2, not 2 and 1.']"
  explain="The switches worth 4 and 2 are on, and 4 + 2 = 6."
/>

### Writing a number in bits

To write a number in bits, work from the left:

1. Start with the first switch, worth 128.
2. If what you still need is at least the switch's value, turn it on and take its value away from what you need.
3. Move to the next switch on the right and do the same, until you need nothing more. Every switch you did not turn on stays 0.

For 192: you need 192, which is at least 128, so turn on 128 and 64 is left. 64 is at least 64, so turn on 64, and nothing is left. The rest stay off: `11000000`.

## A byte: eight bits

Eight bits together are called a <Term means="Eight bits together. One byte holds a whole number from 0 to 255, or one letter of plain English text.">byte</Term>. With all eight switches off, a byte is 0. With all of them on, it is 128 + 64 + 32 + 16 + 8 + 4 + 2 + 1 = 255. So a byte can hold 256 different numbers, from 0 to 255.

Every bit you add doubles how many numbers you can write:

| Bits | Different numbers | From 0 to |
| :--: | :---------------: | :-------: |
|  1   |         2         |     1     |
|  2   |         4         |     3     |
|  4   |        16         |    15     |
|  8   |        256        |    255    |

<TryIt title="Nine challenges">

Make each number with the switches, or read the number they show. The total is hidden at first, so you work it out yourself; turn it on if you get stuck. One of the challenges cannot be done.

<BitChallenges />

</TryIt>

<Quiz
  question="What is the biggest number one byte can hold?"
  :choices="['128', '255', '256', '999']"
  :answer="1"
  :why="['128 is only the first switch. Turn on the other seven as well and it grows to 255.', '', 'A byte holds 256 different numbers, but one of them is 0, so the biggest is 255. 256 would need a ninth bit.', 'That is the biggest number with three of our ten digits. Eight bits reach much less.']"
  explain="With all eight bits on, a byte is 128 + 64 + 32 + 16 + 8 + 4 + 2 + 1 = 255."
/>

## Why this matters for IP addresses

Sizes are counted in bytes too. The 1,500 letters a packet can hold, from the [packets lesson](/academy/beginner/packets), are really 1,500 bytes, because one letter of plain English text takes one byte. A photo of 3 megabytes is about 3 million bytes, and so about two thousand full packets.

An IP address such as `192.168.1.23` is four bytes, which is 32 bits. Written as bits, it is hard to read:

```text
11000000.10101000.00000001.00010111
```

So people write each byte as an ordinary number and put dots between them: 192, 168, 1 and 23. Because each of the four numbers is one byte, none can be more than 255. `192.168.1.300` is not an IP address at all.

<Quiz
  question="Which of these could be an IP address?"
  :choices="['10.0.0.256', '192.168.1.255', '172.16.300.1']"
  :answer="1"
  :why="['The last number is 256, and one byte only goes up to 255.', '', 'The third number is 300, and one byte only goes up to 255.']"
  explain="Every one of its four numbers is between 0 and 255, so each fits in one byte."
/>

## In short

- Computers count with two digits, 0 and 1. One such digit is a bit.
- Each place in binary is worth twice the one to its right: 128, 64, 32, 16, 8, 4, 2, 1.
- To read bits, add the values of the ones that are 1. To write a number, take the biggest values that fit, from the left.
- Eight bits are a byte, which holds a number from 0 to 255.
- An IP address is four bytes, so each of its four numbers is between 0 and 255.
