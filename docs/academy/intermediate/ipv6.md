---
title: IPv6
description: IPv6 addresses are 128 bits, written in hexadecimal. Shorten and expand them by the standard rules, and carve a site's block into a /64 per VLAN.
---

# IPv6

IPv6 is the newer version of IP. Its addresses are 128 bits long instead of 32. They are written as eight groups of four hexadecimal digits, such as `2001:0db8:0000:0000:0000:0000:0000:0001`, and usually shortened to `2001:db8::1`.

There are so many IPv6 addresses that every device can have its own public one. Each VLAN gets a block called a /64. A site gets a /48 or a /56 to share out, and nobody needs NAT.

## Why a second version

IPv4 has 2<sup>32</sup> addresses, about 4.3 billion. That is fewer than the devices online today, so homes and offices share one public address through [NAT](/academy/elementary/nat). IPv6 has 2<sup>128</sup>, a number with 39 digits.

The two run side by side. A router interface usually has an IPv4 address and an IPv6 address, which is called <Term means="Running IPv4 and IPv6 side by side on the same network and devices. A device uses IPv6 when the other end has it, and IPv4 otherwise.">dual stack</Term>. A device uses IPv6 to reach anything that has it.

## Hexadecimal

Written the IPv4 way, as numbers from 0 to 255, an IPv6 address would be sixteen numbers long. So it is written in <Term means="Counting with sixteen digits: 0 to 9, then a to f for ten to fifteen. One hexadecimal digit is exactly four bits.">hexadecimal</Term> instead, with sixteen digits: 0 to 9, then `a` for ten up to `f` for fifteen. Four bits make the numbers 0 to 15, as in [Counting like a computer](/academy/beginner/binary). So one hexadecimal digit is exactly four bits:

| Digit | 0    | 1    | 2    | 3    | 4    | 5    | 6    | 7    |
| ----- | ---- | ---- | ---- | ---- | ---- | ---- | ---- | ---- |
| Bits  | 0000 | 0001 | 0010 | 0011 | 0100 | 0101 | 0110 | 0111 |

| Digit | 8    | 9    | a    | b    | c    | d    | e    | f    |
| ----- | ---- | ---- | ---- | ---- | ---- | ---- | ---- | ---- |
| Bits  | 1000 | 1001 | 1010 | 1011 | 1100 | 1101 | 1110 | 1111 |

A group of four digits is 16 bits, and eight groups are 128 bits. The group `0db8` is `0000 1101 1011 1000`.

## Shortening an address

Most addresses have long runs of zeros, so nobody writes them in full. Shorten an address in this order:

1. Drop the zeros at the start of each group: `0db8` becomes `db8`, and `0000` becomes `0`.
2. Replace the longest run of two or more `0` groups with `::`. Only one `::` is allowed, or nobody could tell how many groups each one stands for.
3. If two runs are equally long, shorten the first. A single `0` group stays `0`.
4. Write the letters in lowercase.

Every device reads an address with at most one `::`, whether it is written in full, half shortened, or in capitals. The four rules come from <Term means="The standard that gives every IPv6 address one recommended way to be written.">RFC 5952</Term>. They give each address one standard short form, so the same address always looks the same in a log or a search.

<TryIt title="Shorten and expand addresses">

<Ipv6Shorten />

</TryIt>

To expand an address, work backwards. Pad each group to four digits. Then count the groups, and put back as many `0000` groups as the `::` needs to make eight.

<Quiz
  question="What is the standard short form of 2001:0db8:0000:0000:0001:0000:0000:0000?"
  :choices="['2001:db8::1:0:0:0', '2001:db8:0:0:1::', '2001:db8::1::', '2001:db8:0:0:1:0:0:0']"
  :answer="1"
  :why="['This is the same address, but the run of two zero groups was shortened, and the run of three at the end is longer.', '', 'Two :: in one address is not allowed: nobody could tell how many zero groups each one stands for.', 'This is the same address, but a run of zero groups that can be :: was left in full.']"
  explain="After dropping leading zeros, the groups are 2001, db8, 0, 0, 1, 0, 0, and 0. There is a run of two zero groups and a run of three. The longer one, at the end, becomes ::."
/>

## A /64 for each network

IPv6 prefixes work like IPv4 ones: `/64` means the first 64 bits are for the network. The block `2001:db8::/32` is set aside for documentation, as `192.0.2.0/24` is for IPv4, so every example here uses it.

Three sizes cover almost every plan:

| Size    | What it is for                            | What it holds   |
| ------- | ----------------------------------------- | --------------- |
| **/64** | One network, such as one VLAN             | One network     |
| **/56** | A small site, often a home                | 256 networks    |
| **/48** | A site such as an office or a data center | 65,536 networks |

Every LAN gets a whole /64, however few devices it has, because the last 64 bits of an address are for the device. A device can make its own address only on a /64, as you see below. With 2<sup>64</sup> addresses on every LAN, a VLAN never runs out of room.

The bits between the site's prefix and the /64 are the subnet number, and you give them out. A common habit is to use a VLAN's number as the subnet's digits: VLAN 20 gets `2001:db8:100:20::/64`. The `20` there is hexadecimal, so it is really 32. But it reads like the VLAN, and that is the point.

<TryIt title="Carve a site into networks">

Try a number that is too big for a /56, or give two VLANs the same one.

<Ipv6Carve />

</TryIt>

<Quiz
  question="Your internet provider gives your site a /56. How many /64 networks can you make from it?"
  :choices="['8', '56', '256', '65,536']"
  :answer="2"
  :why="['8 is the number of bits between /56 and /64. Each bit doubles the count.', 'The 56 is how many bits are fixed by the provider, not a count of networks.', '', 'That is what a /48 holds, which has 16 bits for the subnet number.']"
  explain="Between /56 and /64 there are 8 bits for the subnet number, and 8 bits make 2 to the power of 8, which is 256 numbers."
/>

## Every device has several addresses

An IPv6 device has more than one address. It usually has at least these:

- A **link-local address** in `fe80::/10`. Every interface makes one by itself as soon as IPv6 is on. It works only on that one link, because routers never pass it on. Devices use it to talk to their neighbors, and a router sends its announcements from it.
- A **global address** in the network's /64. The router sends <Term means="A message a router sends on a network to say which /64 prefix the network uses, and that the router is a way out. Devices use it to make their own address and find their gateway.">router advertisements</Term>, and from them each device makes its own address and takes the router as its gateway. This is called <Term means="Stateless address autoconfiguration: a device makes its own address from the /64 a router advertises, with no server to hand it out.">SLAAC</Term>, and it is why a LAN must be a /64. A DHCP server for IPv6 can hand out addresses instead.
- Often one or more **temporary addresses**. The device makes them and changes them from time to time, so the sites it visits can't follow it by its address.

The device also answers to `::1`, which always means "this device".

<Quiz
  question="A laptop on the office VLAN shows three IPv6 addresses. Which one can only be used to reach devices on that same VLAN?"
  :choices="['fe80::1c2b:3eff:fe4d:5a6b', '2001:db8:100:20:1c2b:3eff:fe4d:5a6b', '2001:db8:100:20:8d1:44f2:9a0c:e71']"
  :answer="0"
  :why="['', 'This one is in the office /64, 2001:db8:100:20::/64, so routers pass it on like any global address.', 'This is a global address too, in the same /64. It looks random because it is a temporary address.']"
  explain="Addresses that start with fe80 are link-local. Every interface makes one, and routers never pass them on, so they only reach neighbors on the same link."
/>

## No NAT needed

With 2<sup>64</sup> addresses on every LAN, there is no reason to share one, so IPv6 networks normally do without NAT. Every connection carries the device's own address from end to end.

That makes the firewall more important, not less. NAT was never a firewall, as the [NAT lesson](/academy/elementary/nat) showed. What stops a connection from outside is a [firewall](/academy/elementary/firewall) that drops by default and lets replies back in. In Circuit, a firewall rule without addresses applies to IPv4 and IPv6 alike, so the same `forward` rules protect both.

## IPv6 in Circuit

An IPv6 address goes in `addresses`, beside the IPv4 one:

```ts
interfaces: {
    ethernet: {
        "25g-1": { description: "Internet provider", addresses: ["203.0.113.2/30", "2001:db8:ffff:1::2/64"] },
    },
    vlan_interface: {
        mgmt: { vlan: "mgmt", addresses: ["10.0.10.1/24", "2001:db8:100:10::1/64"] },
        office: { vlan: "office", addresses: ["10.0.20.1/24", "2001:db8:100:20::1/64"], ipv6_ra: true },
    },
},

routing: {
    static_routes: [
        { prefix: "0.0.0.0/0", next_hop: "203.0.113.1", description: "Internet provider" },
        { prefix: "::/0", next_hop: "2001:db8:ffff:1::1", description: "Internet provider" },
        { prefix: "2001:db8:100::/48", blackhole: true, description: "Our site" },
    ],
},
```

- `ipv6_ra: true` makes the router send router advertisements on that VLAN, so the devices there set themselves up. The management VLAN leaves it off, because every device there has an address written by hand.
- `::/0` is the IPv6 default route, like `0.0.0.0/0`.
- The blackhole route for the whole /48 does the same job as in [Routing tables](/academy/intermediate/routing-tables). Traffic for a subnet you don't use yet is dropped, instead of looping back to the provider.
- Link-local addresses are not written anywhere, because the device makes them.

::: warning Not every platform takes IPv6
Raisecom ROS takes no IPv6 addresses or routes, and VRP sends no router advertisements. `circuit validate` reports either as an error. See [Platforms](/reference/platforms).
:::

## In short

- An IPv6 address is 128 bits, written as eight groups of four hexadecimal digits. Each digit is four bits.
- Shorten it by dropping leading zeros, and by writing the longest run of zero groups as `::`, once, in lowercase.
- Each LAN gets a /64. A site gets a /48 or a /56, and numbers its /64 networks, often after its VLANs.
- Every device has several addresses, including a link-local one in `fe80::/10` that it makes itself.
- There is no NAT, so the firewall is what keeps connections from outside out. In Circuit, IPv6 addresses go beside IPv4 ones in `addresses`.
