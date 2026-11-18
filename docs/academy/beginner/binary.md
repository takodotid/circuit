---
title: Counting like a computer
description: Computers count with two digits, 0 and 1. Flip eight switches to read and write every number from 0 to 255, and see why IP addresses stop at 255.
---

# Counting like a computer

Computers count with only the two digits 0 and 1. Eight of these digits together hold any whole number from 0 to 255. That is why each of the four numbers in an IP address is between 0 and 255.

## Counting the way you already do

Think of the distance counter in a car, or the counter on a water meter. It is a row of small wheels, each printed with the digits 0 to 9.

1. Each time the counter goes up by one, the wheel on the right turns to its next digit.
2. When a wheel is at 9 and turns once more, it goes back to 0. On its way round, it pushes the wheel on its left one step.
3. So 9 becomes 10, 19 becomes 20, and 99 becomes 100.

## Counting with two digits

Now picture a counter whose wheels have only the digits 0 and 1. It counts in the same way. But a wheel goes all the way round after just two steps, so it pushes the next wheel much more often.

<TryIt title="Two counters">

<Odometer />

</TryIt>

Computers count with the two-digit counter. Inside a computer, everything is kept in tiny switches that are either off or on. Everything sent over a cable or through the air is a long row of off and on signals. So computers use 0 for off and 1 for on. A digit that can only be 0 or 1 is a <Term means="Short for binary digit: a single 0 or 1. It is the smallest piece of data, and everything a link carries is made of bits.">bit</Term>. Counting with two digits is called **binary**.

### What each wheel is worth

On the ten-digit counter, the second wheel moves once every 10 steps, so a 1 on it means 10. The third wheel moves once every 100 steps, so a 1 on it means 100. So `255` means 2 hundreds, 5 tens, and 5 ones.

The two-digit counter works the same way, with smaller steps. Its right wheel is worth 1. The second wheel moves once every 2 steps, so it is worth 2. The third moves once every 4 steps, so it is worth 4. Each wheel is worth twice the one on its right: 1, 2, 4, 8, 16, 32, 64, and 128.

In the next widget, the two-digit counter is eight switches.

<TryIt title="Eight switches">

Flip some switches on, then press **Count up on its own**.

<BitSwitches tools />

</TryIt>

### Reading a number in bits

To read bits, add up the values of the switches that are on. Here is `10101000`:

| 128 | 64  | 32  | 16  |  8  |  4  |  2  |  1  |
| :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
|  1  |  0  |  1  |  0  |  1  |  0  |  0  |  0  |

The switches worth 128, 32, and 8 are on, so it is 128 + 32 + 8 = 168.

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
2. If what you still need is at least the switch's value, turn the switch on. Take its value away from what you need.
3. Move to the next switch on the right and do the same, until you need nothing more. Every switch you did not turn on stays 0.

For 192: you need 192, which is at least 128. So turn on 128, and 64 is left. 64 is at least 64, so turn on 64, and nothing is left. The rest stay off: `11000000`.

## A byte: eight bits

Eight bits together are a <Term means="Eight bits together. One byte holds a number from 0 to 255, or one letter of plain English text.">byte</Term>. With all eight switches off, a byte is 0. With all of them on, it is 128 + 64 + 32 + 16 + 8 + 4 + 2 + 1 = 255.

To see how many numbers a byte holds, count the patterns that a few switches can make.

<TryIt title="Add a switch">

Start with one switch, then add more.

<BitPatterns />

</TryIt>

Each switch you add doubles the number of patterns. Every old pattern appears twice: once with the new switch off, and once with it on. This also shows what the new switch is worth. It comes on only after every pattern of the switches on its right is used. With three switches on its right, the fourth comes on at 8.

Eight switches make 2 × 2 × 2 × 2 × 2 × 2 × 2 × 2 = 256 patterns. The first pattern, all off, stands for 0, so the last one stands for 255. A car counter with three wheels is the same. It has 1,000 readings, from 000 to 999.

| Switches | Patterns                            | Numbers  |
| :------: | ----------------------------------- | -------- |
|    1     | 2                                   | 0 to 1   |
|    2     | 2 × 2 = 4                           | 0 to 3   |
|    3     | 2 × 2 × 2 = 8                       | 0 to 7   |
|    8     | 2 × 2 × 2 × 2 × 2 × 2 × 2 × 2 = 256 | 0 to 255 |

<TryIt title="Nine challenges">

<BitChallenges />

</TryIt>

<Quiz
  question="What is the biggest number one byte can hold?"
  :choices="['128', '255', '256', '999']"
  :answer="1"
  :why="['128 is only the first switch. Turn on the other seven as well, and it grows to 255.', '', 'A byte holds 256 different numbers, but one of them is 0, so the biggest is 255. 256 would need a ninth bit.', 'That is the biggest number with three ordinary digits. Eight bits reach much less.']"
  explain="With all eight bits on, a byte is 128 + 64 + 32 + 16 + 8 + 4 + 2 + 1 = 255."
/>

## Why this matters for IP addresses

Sizes are counted in bytes too. A packet holds about 1,500 bytes, and a photo of 3 megabytes is about 3 million bytes. So the photo fills about two thousand packets.

An IP address is four bytes, which is 32 bits. Your laptop's address at home, such as `192.168.1.23`, is hard to read as bits:

```text
11000000.10101000.00000001.00010111
```

So people write each byte as an ordinary number, with dots between them: 192, 168, 1, and 23. Each of the four numbers is one byte, so none can be more than 255. `192.168.1.300` is not an IP address at all.

<Quiz
  question="Which of these could be an IP address?"
  :choices="['198.51.100.256', '203.0.113.255', '192.0.300.1']"
  :answer="1"
  :why="['The last number is 256, and one byte only goes up to 255.', '', 'The third number is 300, and one byte only goes up to 255.']"
  explain="Every one of its four numbers is between 0 and 255, so each one fits in a byte."
/>
