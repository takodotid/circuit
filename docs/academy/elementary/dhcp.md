---
title: "Handing out addresses: DHCP"
description: Step through the four DHCP messages, watch a pool of addresses fill and empty, and give a VLAN its gateway and DHCP server in Circuit.
---

# Handing out addresses: DHCP

A device that joins a network needs four things before it can talk to anything: an IP address, the size of its network, a gateway and a DNS server. DHCP hands them out automatically. The device asks, a DHCP server answers with a free address from its pool, and lends it for a set time, called the lease.

On a small network, the DHCP server is usually the router, with one server for each VLAN. In Circuit, you write it in the router's file under `dhcp`.

## What a device needs

| What       | Example                   | What it is for                                                   |
| ---------- | ------------------------- | ---------------------------------------------------------------- |
| IP address | `192.168.20.100`          | Who the device is on the network                                 |
| Mask       | `255.255.255.0`, or `/24` | Which addresses are on its own network, to send to directly      |
| Gateway    | `192.168.20.1`            | Where to send everything else: the router's address in this VLAN |
| DNS server | `192.168.20.1`            | Who turns names into addresses                                   |

You could type these into every laptop, phone and printer by hand, and some devices, such as servers, are still set up that way. But a phone that visits ten networks a week cannot be, and two people who type the same address by hand break each other's connection. So almost every network uses <Term means="Dynamic Host Configuration Protocol: the way a device joining a network asks for an address, a gateway and DNS servers, and gets them from a server.">DHCP</Term> instead.

Your home router has done this for you all along. When your phone joins the Wi-Fi at home, it gets all four from the home router in under a second, which is why [Opening a website](/academy/beginner/opening-a-website) could start with them already in place.

## Four messages

Getting an address takes four messages between the device and the DHCP server. People remember them as DORA: discover, offer, request, acknowledge. They travel over UDP, from port 68 on the device to port 67 on the server.

<TryIt title="Step through a laptop getting its address">

<DhcpSteps />

</TryIt>

The first and third messages were broadcasts. The laptop has no address of its own to send from and does not know where the server is, so it asks everyone in its VLAN. That is also why DHCP works per VLAN: a broadcast stays inside its VLAN, so each VLAN needs a DHCP server of its own that can hear it.

It also means anyone in the VLAN can answer. If a second DHCP server is plugged in by mistake, such as a spare home router, devices take whichever offer arrives first, and some of them get the wrong gateway and lose the internet. When some devices on a network work and others do not, a second DHCP server is worth looking for.

<Quiz
  question="Why does the laptop send its discover message to everyone in the VLAN?"
  :choices="['Because DHCP servers ignore messages sent only to them', 'Because it has no address yet and does not know where the server is', 'Because every device in the VLAN must agree to the new address']"
  :answer="1"
  :why="['A server answers messages sent only to it, too: that is how a device renews its lease later.', '', 'Only the DHCP server decides. The other devices hear the broadcast and ignore it.']"
  explain="A broadcast is the one way to reach a server whose address you do not know, when you have no address yourself."
/>

## The pool and the lease

The server does not hand out just any address. It lends from its <Term means="The range of addresses a DHCP server may lend to devices, from a first to a last address.">pool</Term>, a range such as `192.168.20.100` to `192.168.20.200`, and keeps the rest of the network, such as `.1` to `.99`, for the router and for devices whose address is set by hand.

Each address is lent for a lease time. A device that stays asks to renew its lease when half of it has passed, so it keeps its address. A device that leaves usually does not say so, and the server keeps its address for it until the lease runs out.

Try a guest Wi-Fi with a small pool. Here, as in real life, guests arrive and leave as you choose, and nothing happens at random.

<TryIt title="Fill a pool, and let leases end">

<DhcpPool />

</TryIt>

With day-long leases, the pool filled with addresses kept for guests who had already gone home, and the next guest got nothing. A shorter lease frees an address soon after its guest leaves, and costs nothing for the guests who stay, because they renew. That is why guest networks use short leases, an hour or so, and an office where the same laptops come every day can use long ones.

<Quiz
  question="A café’s guest Wi-Fi has 50 addresses and day-long leases. About 200 guests pass through each day, each staying an hour. What goes wrong?"
  :choices="['Nothing: only a few guests are there at any one time', 'Within a few hours, the pool is full of addresses kept for guests who left', 'The guests who stay lose their addresses after an hour']"
  :answer="1"
  :why="['The server cannot know a guest left. It keeps each address for the whole lease, a full day.', '', 'Guests who stay renew their lease halfway through, so they keep their address.']"
  explain="Every guest keeps an address for a day, even after leaving, so 50 guests fill the pool. Lease times of an hour, or a bigger pool, fix it."
/>

## The gateway, on a VLAN interface

In [Trunks](/academy/elementary/trunks), the router reached every VLAN over one trunk port. It still needs an address in each VLAN, to be that VLAN's gateway. Since one port carries them all, the address cannot go on the port. It goes on a <Term means="An interface on a router or switch that sits on one VLAN instead of on a port. It gives the device an address in that VLAN.">VLAN interface</Term> instead: one for each VLAN, each with its own address.

This is the router from Circuit's single-site pattern, which you build in the [last project](/academy/elementary/project-single-site) of this level:

```ts
ports: {
    "25g-1": {
        description: "Switch",
        speed: "10g",
        trunk_vlans: ["mgmt", "home", "guests"],
        link: { device: "switch", port: "10g-1" },
    },
},

// The gateway of each VLAN.
interfaces: {
    mgmt: { type: "vlan", vlan: "mgmt", addresses: ["192.168.10.1/24"] },
    home: { type: "vlan", vlan: "home", addresses: ["192.168.20.1/24"] },
    guests: { type: "vlan", vlan: "guests", addresses: ["192.168.30.1/24"] },
},

dhcp: {
    home: {
        interface: "home",
        network: "192.168.20.0/24",
        gateway: "192.168.20.1",
        dns: ["192.168.20.1"],
        pool: ["192.168.20.100", "192.168.20.200"],
    },
    guests: {
        interface: "guests",
        network: "192.168.30.0/24",
        gateway: "192.168.30.1",
        dns: ["192.168.30.1"],
        pool: ["192.168.30.100", "192.168.30.200"],
        lease_time: 3600,
    },
},
```

Each entry in `interfaces` with `type: "vlan"` sits on the VLAN in its `vlan` field, and its `addresses` give the router its address in that VLAN. Each DHCP server then says:

| Field        | What it says                                                                |
| ------------ | --------------------------------------------------------------------------- |
| `interface`  | Where it answers: the VLAN interface of its VLAN.                           |
| `network`    | The network it serves.                                                      |
| `gateway`    | The gateway it hands out: the router's own address on that VLAN interface.  |
| `dns`        | The DNS servers it hands out. Here the router answers DNS questions itself. |
| `pool`       | The first and last address it lends.                                        |
| `lease_time` | How long a lease lasts, in seconds. 3600 is one hour, short, for guests.    |

The mgmt VLAN has no DHCP server: the devices on it have addresses written in their own files. Circuit checks that the gateway and the pool are inside the network. A pool that ends at `192.168.21.5` stops `circuit validate` with:

```text
  error  router: DHCP home: 192.168.21.5 is outside 192.168.20.0/24
```

Some devices, such as a printer, are easier to find when their address never changes. A reservation ties an address to one hardware address, and the server always lends that device the same one:

```ts
reservations: [{ address: "192.168.20.20", mac: "00:00:5e:00:53:20", description: "Printer" }],
```

::: tip A DHCP server elsewhere
A bigger network may run one DHCP server for every VLAN, on a server of its own. A broadcast cannot reach it across a router, so the router passes the requests on, with `dhcp_relay`. See the [schema reference](/reference/schema).
:::

## In short

- A device needs an address, a mask, a gateway and DNS servers, and DHCP hands them out automatically.
- It takes four messages, discover, offer, request and acknowledge, and the device broadcasts because it has no address yet.
- Addresses are lent from a pool for a lease time. Devices that stay renew halfway; addresses of devices that left are freed when the lease ends.
- The gateway of a VLAN is the router's address on a VLAN interface, written in Circuit as `interfaces` with `type: "vlan"`.
- Each VLAN gets a DHCP server under `dhcp`, with its `interface`, `network`, `gateway`, `dns`, `pool` and `lease_time`.
