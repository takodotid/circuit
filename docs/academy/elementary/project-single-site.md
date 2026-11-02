---
title: "Project: a single site"
description: Build a router and a switch for a small site from the single-site example, fix the mistakes validate finds, then diff and apply.
---

# Project: a single site

In this project you put the whole level together: a router and a switch for a home or a small office, written in Circuit, checked, and applied. You do not start from an empty folder. Circuit's [single-site example](/guide/examples#a-single-site) is a working project of exactly this network, and you make it your own. Along the way you read every file, find each lesson in it, and fix the mistakes `circuit validate` catches.

## The site

- **Three VLANs**: `mgmt` (10) for logging in to the devices, `home` (20) for your own devices, and `guests` (30) for visitors, kept off the other two.
- **The switch** has a port for each device on the site, each in its VLAN, and a trunk to the router that carries all three.
- **The router** has the internet connection on its port `1g-1`. For each VLAN it is the gateway and the DHCP server, its firewall keeps guests in their place, and NAT shares its one public address.

The switch only moves frames inside each VLAN. Everything that crosses from one VLAN to another, or to the internet, goes through the router, which is why the addresses, the firewall and NAT are on the router. That is [Layers](/academy/elementary/layers) at work: the switch works at layer 2, the router at layer 3.

## Start the project

[Install Circuit](/guide/install), then run `circuit new my-network`. It asks a few questions and writes an empty project. Copy the example's files into it:

```text
my-network/
  circuit.ts             the network: its sites, and the checks
  sites/home/site.ts     what both devices share
  sites/home/router.ts
  sites/home/switch.ts
  lib/checks.ts          a check of your own
  .env                   the devices' passwords, encrypted
```

Each device is one file, and the file is the whole truth, as in [Writing a network down](/academy/elementary/writing-it-down). Read them in this order.

## site.ts: what both devices share

<<< @/../examples/single-site/sites/home/site.ts

The VLANs are written once, by name, and both devices take the same ones, so the switch and the router can never disagree about which number `guests` is ([VLANs](/academy/elementary/vlans)). `management` is the one network allowed to log in, and `router` and `switch` are each device's address on it ([Keeping the keys](/academy/elementary/management)). Change these to your own first.

## switch.ts

<<< @/../examples/single-site/sites/home/switch.ts

- `10g-1` is the trunk to the router. It carries all three VLANs, and `link` says which port is at the other end of the cable, so `validate` can check that both ends carry the same ones ([Trunks](/academy/elementary/trunks)). Its description names the far end, as the router prints its port.
- `10g-2` to `10g-4` are access ports, each in one VLAN. A device plugged into one of them does not know VLANs exist.
- The switch has one address of its own, on `mgmt`, so you can log in to it, and a default route to the router, its gateway.
- `lldp: true` lets the switch tell its neighbors who it is. `stp: { edge: true }` marks a port with a single device on it, so the port comes up at once instead of waiting; the Intermediate level explains why a switch waits.

## router.ts

<<< @/../examples/single-site/sites/home/router.ts

Each part of it is a lesson of this level:

- **`25g-1`** is the other end of the trunk, with the same three VLANs and a `link` back ([Trunks](/academy/elementary/trunks)).
- **`vlan_interface`** gives the router an address on each VLAN, the gateway for that VLAN, and **`dhcp_server`** hands out addresses, the gateway and the DNS server to every device that joins ([DHCP](/academy/elementary/dhcp)).
- **`1g-1`** has the public address from your provider, and the static route sends everything that is not at home to the provider. Change both to what your provider gave you.
- **`dns_server: true`** lets the router answer DNS questions, which is why the input firewall accepts DNS from home and guests.
- **`firewall.filter`** decides what may pass, to the router and through it ([Firewalls](/academy/elementary/firewall)), and **`firewall.nat`** shares the public address ([NAT](/academy/elementary/nat)).
- **`system.users`**, **`management`** and **`secret`** keep the keys ([Keeping the keys](/academy/elementary/management)).

## circuit.ts and lib/checks.ts

<<< @/../examples/single-site/circuit.ts

<<< @/../examples/single-site/lib/checks.ts

`circuit.ts` is the network: its one site, and the checks. `same_vlan_ids` is one of Circuit's own: one VLAN name has one number on every device. `management_stays_on_trunks` is the project's own, in `lib/checks.ts`: no access port gives the management VLAN to whatever plugs in. A network without BGP needs nothing more.

## Fix what validate finds

`circuit validate` checks every file, the two ends of every cable, and your checks. Your editor catches some mistakes before that, such as a VLAN name that does not exist. Here are five mistakes that are easy to make while you change the example to your own.

<TryIt title="Fix the files">

Each mistake below was made in the single-site example, one at a time, and `circuit validate` was run on it: what you see is what it printed. Find the mistake, run validate, read what it says, and pick the fix.

<FixTheSite />

</TryIt>

Look at how each message points at its cause. A trunk that carries different VLANs at its two ends is reported from both ends, with the VLAN numbers. The check from `lib/checks.ts` speaks in your own words, because you wrote it, with the file and line of the port. And for an address used twice, the message gives both devices that have it.

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

With the files right, the rest is a handful of commands. Step through them: the output shown is what Circuit printed for this example, and the commands that need a real device to answer are shown without output.

<TryIt title="From an empty folder to a change">

<SiteCommands />

</TryIt>

1. **`secret set`** writes each password to `.env`, encrypted, and **`secret`** checks that every password the files ask for is there.
2. **`validate`** checks the files.
3. **`diff`** logs in, reads what the device runs right now, and shows the plan. It changes nothing.
4. **`apply`** shows the same plan and asks. Say yes, and it sends the plan, then logs in again to make sure it still can.

Apply the switch first, then the router: a mistake on the router can cut you off from both.

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

Commit the device files after every apply. Git then keeps the history of your network: what each device was told to run, who changed it, and why.

## In short

| Lesson                                                        | Where it is in the project                                                 |
| ------------------------------------------------------------- | -------------------------------------------------------------------------- |
| [Layers](/academy/elementary/layers)                          | the switch moves frames inside VLANs, the router routes between them       |
| [Writing a network down](/academy/elementary/writing-it-down) | one file per device, `validate`, `diff`, `apply`, and git for history      |
| [VLANs](/academy/elementary/vlans)                            | `vlans` in `site.ts`, `access_vlan` on the switch's ports                  |
| [Trunks](/academy/elementary/trunks)                          | `trunk_vlans` and `link` on `10g-1` and `25g-1`                            |
| [DHCP](/academy/elementary/dhcp)                              | the router's `vlan_interface` and `services.dhcp_server`                   |
| [NAT](/academy/elementary/nat)                                | `firewall.nat.source`                                                      |
| [Firewalls](/academy/elementary/firewall)                     | `firewall.filter.input` and `forward`                                      |
| [Keeping the keys](/academy/elementary/management)            | `system.users`, `management`, `secret()`, and the check in `lib/checks.ts` |

- Start from the single-site example, and change `site.ts` first.
- `validate` catches mismatched trunks, missing names, addresses used twice and your own checks; an error stops every change.
- `diff` reads the device and shows the plan; `apply` shows it again and sends it only once you say yes.
- Commit the files after every apply.
