---
title: Reading an IP address
description: An IP address is 32 bits, split into a network part and a host part. Slide the split, read a prefix such as /24, and tell which devices share a network.
---

# Reading an IP address

An IP address such as `192.168.1.37` is 32 bits, written as four numbers from 0 to 255. The first bits say which network the device is on, and the rest say which device it is inside that network. The **prefix length**, written after the address as in `192.168.1.37/24`, says how many of the bits are for the network.

## Four bytes, 32 bits

The addresses in these lessons are **IPv4** addresses: version 4 of the Internet Protocol, the kind almost every network uses. A newer kind, IPv6, has much longer addresses, and comes in the Intermediate level.

As you saw in the [binary lesson](/academy/beginner/binary), an IPv4 address is four bytes, which is 32 bits. Nobody wants to read 32 ones and zeros, so each byte is written as a number from 0 to 255, with dots between them.

## The network part and the host part

A phone number works a bit like an IP address. Its first digits are the area code, which says which area the phone is in, and the rest say which phone in that area it is. Everyone in one area shares the same area code.

An IP address has the same two parts:

- The **network part**, the first bits, says which network the device is on. Every device on one network has the same network part.
- The **host part**, the rest of the bits, says which device in that network it is. Each device on the network has its own. In networking, a device with an address is often called a <Term means="Any device that has an IP address on a network: a laptop, a phone, a printer, a server.">host</Term>.

Here the phone number stops being a good comparison. In a phone number, everyone knows how long the area code is. In an IP address, you cannot tell where the network part ends by looking at the address alone. The network decides, and the prefix length tells you: `/24` means the first 24 bits are the network part, and the other 8 are the host part.

<TryIt title="Slide the split">

The address is shown as its 32 bits, with the network part in blue. Move the slider, or pick a length, and watch the split move. Try your own address too.

<PrefixSlider />

</TryIt>

At `/24`, the network part is exactly the first three numbers, `192.168.1`, and the host part is the last number, `37`. At `/16`, the network is `192.168` and the last two numbers are the host part. At `/25`, the split goes right through the last number: part of `37` belongs to the network. That is why it helps to think in bits: the split falls between two bits, not always between two numbers.

## The mask says the same thing

You will often see a second way of writing the prefix length, called the <Term means="Another way of writing the prefix length: 32 bits with a 1 for every network bit and a 0 for every host bit, written like an address, such as 255.255.255.0.">mask</Term>. It is 32 bits too: a 1 under every network bit and a 0 under every host bit, written the way an address is written. You saw it in the second row of bits.

For `/24`, the mask is 24 ones and 8 zeros. Eight ones are 255, eight zeros are 0, so the mask is `255.255.255.0`. Settings screens show the mask, and these lessons mostly use the prefix length, so it helps to know both:

| Prefix length | Mask              | Addresses in all | For devices |
| :-----------: | ----------------- | ---------------: | ----------: |
|     `/8`      | `255.0.0.0`       |       16,777,216 |  16,777,214 |
|     `/16`     | `255.255.0.0`     |           65,536 |      65,534 |
|     `/24`     | `255.255.255.0`   |              256 |         254 |
|     `/25`     | `255.255.255.128` |              128 |         126 |
|     `/30`     | `255.255.255.252` |                4 |           2 |

In `/25`, the mask's last number is `128`: only the first bit of the last byte is a network bit, and that bit is worth 128.

<Quiz
  question="Which mask says the same as /16?"
  :choices="['255.255.0.0', '255.255.255.0', '255.0.0.0', '16.16.16.16']"
  :answer="0"
  :why="['', 'That mask has 24 ones, so it is /24.', 'That mask has only 8 ones, so it is /8.', 'A mask is not the prefix length written four times. It is a 1 for every network bit, written like an address.']"
  explain="/16 means 16 network bits: two bytes of ones, which are 255 and 255, and two bytes of zeros."
/>

## How many addresses a network holds

Every host bit can be 0 or 1, so each one doubles the number of addresses. With 8 host bits, a `/24` holds 2 × 2 × 2 × 2 × 2 × 2 × 2 × 2 = 256 addresses. A `/25` has one host bit fewer, so it holds half as many: 128. Every step to the right halves the block.

Two of the addresses in every block are not given to a device:

- The **first** address, with every host bit 0, is the **network address**. It stands for the network as a whole, as in "the network `192.168.1.0/24`".
- The **last** address, with every host bit 1, is the <Term means="The last address of a network. A packet sent to it goes to every device on that network at once.">broadcast address</Term>. A packet sent to it goes to every device on the network at once.

So a `/24` such as `192.168.1.0/24` has room for 254 devices, from `192.168.1.1` to `192.168.1.254`. A `/30` holds only four addresses, two of them for devices, which is just right for a cable between two routers.

<Quiz
  question="How many devices can have an address in 10.1.1.0/25?"
  :choices="['128', '126', '254']"
  :answer="1"
  :why="['A /25 holds 128 addresses, but the first and the last are not given to a device.', '', 'That is a /24. A /25 has one host bit fewer, so it holds half as many addresses.']"
  explain="7 host bits make 128 addresses. The first is the network address and the last the broadcast address, which leaves 126 for devices."
/>

## Same network or not?

Two devices are on the same network when their network parts are the same. Devices on the same network can send packets straight to each other. For a device on another network, a packet has to go through a router, which is the subject of the [routers lesson](/academy/beginner/routers).

To check two addresses:

1. Take the prefix length, say `/24`.
2. Compare that many bits of the two addresses, from the left.
3. If they are all the same, the devices are on the same network. If even one differs, they are not.

When the prefix length is 8, 16 or 24, you can compare whole numbers: for `/24`, compare the first three. For any other length, you have to look at the bits of the number the split goes through.

<TryIt title="Same network or not?">

A laptop and a printer, nine times. Say whether they are on the same network, then look at their bits side by side.

<SameNetwork />

</TryIt>

The pairs with `/25` and `/30` are the tricky ones. `192.168.1.100` and `192.168.1.130` share their first three numbers, but at `/25` the first bit of the last number is part of the network too. In 100 that bit is 0, in 130 it is 1, so they are on different networks.

## Private addresses

Three blocks of addresses are set aside for use inside homes and offices:

| Block            | From          | To                |  Addresses |
| ---------------- | ------------- | ----------------- | ---------: |
| `10.0.0.0/8`     | `10.0.0.0`    | `10.255.255.255`  | 16,777,216 |
| `172.16.0.0/12`  | `172.16.0.0`  | `172.31.255.255`  |  1,048,576 |
| `192.168.0.0/16` | `192.168.0.0` | `192.168.255.255` |     65,536 |

Anyone may use these **private addresses** inside their own network, so millions of homes use the very same ones. Your home router probably hands out addresses that start with `192.168.`. Because so many networks use them, private addresses are not used on the internet itself, and a device with one cannot be reached straight from the internet. How a home full of private addresses still reaches the internet is a lesson in the Elementary level.

<Quiz
  question="Which of these addresses is private?"
  :choices="['172.20.1.5', '172.40.1.5', '193.168.1.5']"
  :answer="0"
  :why="['', 'The private block starting with 172 runs from 172.16 to 172.31 only. 40 is outside it.', 'It looks like 192.168, but it starts with 193, which is not a private block.']"
  explain="172.16.0.0/12 runs from 172.16.0.0 to 172.31.255.255, and 172.20 is inside it."
/>

## In short

- An IPv4 address is 32 bits, written as four numbers from 0 to 255.
- The first bits are the network part, the same for every device on the network; the rest are the host part, different for each device.
- The prefix length, such as `/24`, says how many bits are the network part. The mask, such as `255.255.255.0`, says the same thing another way.
- Each host bit doubles the size of a block: 8 host bits make 256 addresses. The first stands for the network and the last is the broadcast address, so neither goes to a device.
- Two devices are on the same network when their network parts match. `10.0.0.0/8`, `172.16.0.0/12` and `192.168.0.0/16` are private, for use inside homes and offices.
