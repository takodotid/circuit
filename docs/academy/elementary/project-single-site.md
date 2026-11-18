---
title: "Project: a single site"
description: Build a router and a switch for a small site from the single-site example, fix the mistakes validate finds, then diff and apply.
---

# Project: a single site

You build a router and a switch for a home or a small office. You start from Circuit's [single-site example](/guide/examples#a-single-site), a working project of exactly this network, and make it your own.

## The site

- **Three VLANs**: `mgmt` (10) for logging in to the devices, `home` (20) for your own devices, and `guests` (30) for visitors, kept off the other two.
- **The switch** has a port for each device on the site, each in its VLAN, and a trunk to the router that carries all three.
- **The router** has the internet connection on its port `1g-1`. For each VLAN it is the gateway and the DHCP server. Its firewall keeps guests in their place, and NAT shares its one public address.

The switch only moves frames inside each VLAN. Everything that crosses from one VLAN to another, or to the internet, goes through the router. So the addresses, the firewall, and NAT are on the router. That is [Layers](/academy/elementary/layers) at work: the switch works at layer 2, the router at layer 3.

## Start the project

[Install Circuit](/guide/install), then run `circuit new my-network`. It asks a few questions and writes an empty project. Copy the example's files into it:

```text
my-network/
  circuit.ts             the network: its sites, and the checks
  sites/home/site.ts     what both devices share
  sites/home/router.ts
  sites/home/switch.ts
  lib/checks.ts          a check of your own
  .circuit/secrets       the devices' passwords, encrypted
```

Each device is one file, and the file is the whole truth, as in [Writing a network down](/academy/elementary/writing-it-down). Read them in this order.

## The site file: `site.ts`

<<< @/../examples/single-site/sites/home/site.ts

The VLANs are written once, by name, and both devices take the same ones, so the switch and the router can never disagree about which number `guests` is ([VLANs](/academy/elementary/vlans)). `management` is the one network allowed to log in, and `router` and `switch` are each device's address on it ([Keeping the keys](/academy/elementary/management)). Change these to your own first.

## The switch: `switch.ts`

<<< @/../examples/single-site/sites/home/switch.ts

- `10g-1` is the trunk to the router. It carries all three VLANs, and `link` says which port is at the other end of the cable. So `validate` can check that both ends carry the same ones ([Trunks](/academy/elementary/trunks)). Its description gives the far end as the router prints it.
- `10g-2` to `10g-4` are access ports, each in one VLAN. A device plugged into one of them does not know VLANs exist.
- The switch has one address of its own, on `mgmt`, so you can log in to it, and a default route to the router, its gateway.
- `lldp: true` lets the switch tell its neighbors who it is. `stp: { edge: true }` marks a port with a single device on it, so the port comes up at once instead of waiting. [Staying up](/academy/intermediate/redundancy) explains why a switch waits.

## The router: `router.ts`

<<< @/../examples/single-site/sites/home/router.ts

- **`25g-1`** is the other end of the trunk, with the same three VLANs and a `link` back ([Trunks](/academy/elementary/trunks)).
- **`vlan_interface`** gives the router an address on each VLAN, the gateway for that VLAN. **`dhcp_server`** hands out addresses, the gateway, and the DNS server to every device that joins ([DHCP](/academy/elementary/dhcp)).
- **`1g-1`** has the public address from your provider, and the static route sends everything that is not at home to the provider. Change both to what your provider gave you.
- **`dns_server: true`** lets the router answer DNS questions, which is why the input firewall accepts DNS from home and guests.
- **`firewall.filter`** decides what may pass, to the router and through it ([firewall](/academy/elementary/firewall)). **`firewall.nat`** shares the public address ([NAT](/academy/elementary/nat)).
- **`system.users`**, **`management`**, and **`secret`** keep the keys ([Keeping the keys](/academy/elementary/management)).

## The network: `circuit.ts` and `lib/checks.ts`

<<< @/../examples/single-site/circuit.ts

<<< @/../examples/single-site/lib/checks.ts

`circuit.ts` is the network: its one site, and the checks. `same_vlan_ids` is one of Circuit's own: one VLAN name has one number on every device. `management_stays_on_trunks` is the project's own, in `lib/checks.ts`: no access port gives the management VLAN to whatever plugs in. A network without BGP needs nothing more.

## Fix what validate finds

`circuit validate` checks every file, the two ends of every cable, and your checks. Your editor catches some mistakes before that, such as a VLAN name that does not exist. Here are five mistakes that are easy to make while you change the example to your own.

<TryIt title="Fix the files">

<FixTheSite />

</TryIt>

Each message points at its cause: the device, the field, and often the file and line. Your own check speaks in the words you gave it in `lib/checks.ts`.

An error stops `diff` and `apply`, so none of these can reach a device. A warning, like the cable described in your own words, is printed and stops nothing.

<Quiz
  question="validate prints one warning and no errors. You run circuit diff switch. What happens?"
  :choices="['diff refuses to run until the warning is gone', 'diff prints the warning and then the plan', 'diff runs, and the warning is sent to the device']"
  :answer="1"
  :why="['Only an error stops diff and apply. A warning is there for you to read.', '', 'Nothing about a warning is sent to a device. It is only printed.']"
  explain="A warning is printed and nothing is stopped. Only an error stops diff and apply."
/>

<Quiz
  question="Which part of the files keeps a guest phone from reaching the printer on the home VLAN?"
  :choices="['The access ports in switch.ts, which put them in different VLANs', 'The forward chain in router.ts, which drops whatever no rule lets through', 'The DHCP pool for guests in router.ts']"
  :answer="1"
  :why="['Different VLANs keep them apart on the switch, but the router joins the VLANs. Without a rule, it would pass the packet from one to the other.', '', 'DHCP hands out addresses. It decides nothing about where a device may go.']"
  explain="The VLANs send every packet between guests and home through the router. Its forward chain only lets home and guests out to the internet, so the default drops a guest going to home."
/>

## From the files to the devices

<TryIt title="From the files to a change">

<SiteCommands />

</TryIt>

::: danger The first plan is long
A device that was set up by hand runs many things your files do not describe yet. The first plan removes all of them, because the file is the whole truth. Read it line by line, and add to the file whatever must stay, until the plan has only changes you want.
:::

<Quiz
  question="Yesterday you ran diff. This morning a colleague changed the switch by hand. You run circuit apply switch. What does its plan compare your files with?"
  :choices="['What the switch runs right now, including the colleague’s change', 'What the switch ran yesterday, when you ran diff', 'Nothing: you must run diff again first']"
  :answer="0"
  :why="['', 'Circuit keeps no copy of what a device ran. Every diff and apply reads the device again.', 'apply reads the device itself. It needs no diff before it.']"
  explain="diff and apply both read the device every time, so the plan always starts from what it runs now, the colleague’s change included."
/>
