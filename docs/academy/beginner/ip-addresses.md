---
title: Reading an IP address
description: An IP address is 32 bits, split into a network part and a host part. Slide the split, read a prefix such as /24, and tell which devices share a network.
---

# Reading an IP address

Your laptop at home may have the IP address `192.168.1.37`. Its first bits say which network the laptop is on. The rest say which device it is on that network.

These lessons use **IPv4** addresses, version 4 of the Internet Protocol. Almost every network uses them. A newer kind, IPv6, has much longer addresses. It comes in the Intermediate level. An IPv4 address is four bytes, or 32 bits, as you saw in [Counting like a computer](/academy/beginner/binary).

## The network part and the host part

A phone number works a bit like an IP address. Its first digits are the area code, which says which area the phone is in. The rest say which phone in that area it is. Everyone in one area has the same area code.

An IP address has the same two parts:

- The **network part**, the first bits, says which network the device is on. Every device on one network has the same network part.
- The **host part**, the rest of the bits, says which device on that network it is. Each device on the network has its own. In networking, a device with an address is often called a <Term means="Any device with an IP address on a network, such as a laptop, a phone, a printer, or a server.">host</Term>.

Here the phone number stops being a good comparison. Everyone knows how long an area code is. But you cannot tell where the network part of an IP address ends from the address alone. The network decides. The **prefix length**, written after the address as in `192.168.1.37/24`, tells you. `/24` means the first 24 bits are the network part, and the other 8 are the host part.

<TryIt title="Slide the split">

Try your own address too.

<PrefixSlider />

</TryIt>

At `/24`, the network part is the first three numbers, `192.168.1`. At `/16`, it is the first two, `192.168`. At `/25`, the split goes through the last number, so part of `37` belongs to the network. So think in bits: the split falls between two bits, not always between two numbers.

## The mask says the same thing

Another way to write the prefix length is the <Term means="Another way to write a prefix length, such as 255.255.255.0 for /24. It has 32 bits: a 1 for each network bit, and a 0 for each host bit.">mask</Term>. It is 32 bits too, with a 1 under every network bit and a 0 under every host bit. It is written the way an address is written.

For `/24`, the mask is 24 ones and 8 zeros. Eight ones are 255, and eight zeros are 0, so the mask is `255.255.255.0`. Settings screens often show the mask, and these lessons use the prefix length.

| Prefix length | Mask              | Addresses in all | For devices |
| :-----------: | ----------------- | ---------------: | ----------: |
|     `/8`      | `255.0.0.0`       |       16,777,216 |  16,777,214 |
|     `/16`     | `255.255.0.0`     |           65,536 |      65,534 |
|     `/24`     | `255.255.255.0`   |              256 |         254 |
|     `/25`     | `255.255.255.128` |              128 |         126 |
|     `/30`     | `255.255.255.252` |                4 |           2 |

In `/25`, the mask's last number is `128`. Only the first bit of the last byte is a network bit, and that bit is worth 128.

<Quiz
  question="Which mask says the same as /16?"
  :choices="['255.255.0.0', '255.255.255.0', '255.0.0.0', '16.16.16.16']"
  :answer="0"
  :why="['', 'That mask has 24 ones, so it is /24.', 'That mask has only 8 ones, so it is /8.', 'A mask is not the prefix length written four times. It is a 1 for every network bit, written like an address.']"
  explain="/16 means 16 network bits: two bytes of ones, which are 255 and 255, and two bytes of zeros."
/>

## How many addresses a network holds

An address with a prefix length, such as `192.168.1.0/24`, can also stand for a whole block of addresses. That block is called a <Term means="A block of addresses, such as 198.51.100.0/24. The number after the slash says how many bits belong to the network.">prefix</Term>.

Every host bit can be 0 or 1, so each host bit doubles the number of addresses. With 8 host bits, a `/24` holds 2 × 2 × 2 × 2 × 2 × 2 × 2 × 2 = 256 addresses. A `/25` has one host bit fewer, so it holds half as many: 128. Each step to the right halves the block.

Two addresses in every block are not given to a device:

- The **first** address, with every host bit 0, is the **network address**. It stands for the network as a whole, as in "the network `192.168.1.0/24`".
- The **last** address, with every host bit 1, is the <Term means="The last address of a network. A packet sent to it goes to every device on that network at once.">broadcast address</Term>. A packet sent to it goes to every device on the network at once.

So `192.168.1.0/24` has room for 254 devices, from `192.168.1.1` to `192.168.1.254`. A `/30` holds only four addresses, and two of them are for devices. That is just right for a cable between two routers.

<Quiz
  question="How many devices can have an address in 10.1.1.0/25?"
  :choices="['128', '126', '254']"
  :answer="1"
  :why="['A /25 holds 128 addresses, but the first and the last are not given to a device.', '', 'That is a /24. A /25 has one host bit fewer, so it holds half as many addresses.']"
  explain="7 host bits make 128 addresses. The first is the network address and the last is the broadcast address, which leaves 126 for devices."
/>

## Same network or not?

Two devices are on the same network when their network parts are the same. Devices on the same network can send packets straight to each other. A packet for a device on another network goes through a router. [Routers and the gateway](/academy/beginner/routers) shows how.

To check two addresses:

1. Take the prefix length, say `/24`.
2. Compare that many bits of the two addresses, from the left.
3. If they are all the same, the devices are on the same network. If even one bit is different, they are not.

When the prefix length is 8, 16, or 24, you can compare whole numbers. For `/24`, compare the first three. For any other length, look at the bits of the number the split goes through.

<TryIt title="Same network or not?">

<SameNetwork />

</TryIt>

The pairs with `/25` and `/30` are the hard ones. `192.168.1.100` and `192.168.1.130` share their first three numbers. But at `/25`, the first bit of the last number is part of the network too. In 100 that bit is 0, and in 130 it is 1, so they are on different networks.

## Private addresses

Three blocks of addresses are set aside for use inside homes and offices:

| Block            | From          | To                |  Addresses |
| ---------------- | ------------- | ----------------- | ---------: |
| `10.0.0.0/8`     | `10.0.0.0`    | `10.255.255.255`  | 16,777,216 |
| `172.16.0.0/12`  | `172.16.0.0`  | `172.31.255.255`  |  1,048,576 |
| `192.168.0.0/16` | `192.168.0.0` | `192.168.255.255` |     65,536 |

Anyone may use these **private addresses** inside their own network, so millions of homes use the same ones. Your home router probably hands out addresses that start with `192.168.`. Because so many networks use them, private addresses are never used on the internet itself. A device with one cannot be reached straight from the internet. The [lesson on NAT](/academy/elementary/nat) shows how a home with private addresses still reaches the internet.

<Quiz
  question="Which of these addresses is private?"
  :choices="['172.20.1.5', '198.51.100.5', '203.0.113.5']"
  :answer="0"
  :why="['', 'No private block starts with 198.', 'No private block starts with 203.']"
  explain="172.16.0.0/12 runs from 172.16.0.0 to 172.31.255.255, and 172.20 is inside it."
/>
