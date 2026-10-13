---
title: "Project: a single site"
description: Build a router and a switch for a small site from the single-site pattern, fix the mistakes validate finds, then diff and apply.
---

# Project: a single site

In this project you put the whole level together: a router and a switch for a home or a small office, written in Circuit, checked, and applied. You do not start from an empty folder. `circuit new` gives you the single-site pattern, a working example of exactly this network, and you make it your own. Along the way you read every file, find each lesson in it, and fix the mistakes `circuit validate` catches.

## The site

- **Three VLANs**: `mgmt` (10) for logging in to the devices, `home` (20) for your own devices, and `guests` (30) for visitors, kept off the other two.
- **The switch** has a port for each device on the site, each in its VLAN, and a trunk to the router that carries all three.
- **The router** has the internet connection on its port `1g-1`. For each VLAN it is the gateway and the DHCP server, its firewall keeps guests in their place, and NAT shares its one public address.

The switch only moves frames inside each VLAN. Everything that crosses from one VLAN to another, or to the internet, goes through the router, which is why the router holds the addresses, the firewall and NAT. That is [Layers](/academy/elementary/layers) at work: the switch works at layer 2, the router at layer 3.

## Start the project

```bash
npx @takodotid/circuit new my-network --pattern single-site
```

It creates a folder with these files, and installs Circuit:

```text
my-network/
  circuit.config.ts    the devices and the checks
  site.ts              values both devices share
  router.ts
  switch.ts
  checks.ts            rules of your own
  .env                 the devices' passwords, never committed
```

Each device is one file, and the file is the whole truth, as in [Writing a network down](/academy/elementary/writing-it-down). Read them in this order.

## site.ts: what both devices share

<<< @/../templates/single-site/site.ts

The VLANs are written once, by name, and both devices use the same list, so the switch and the router can never disagree about which number `guests` is ([VLANs](/academy/elementary/vlans)). `MANAGEMENT` is the one network allowed to log in, and `ROUTER` is the router's address on it ([Keeping the keys](/academy/elementary/management)). Change these to your own first.

## switch.ts

<<< @/../templates/single-site/switch.ts

- `10g-1` is the trunk to the router. It carries all three VLANs, and `link` names the port at the other end, so `validate` can check that both ends carry the same ones ([Trunks](/academy/elementary/trunks)).
- `10g-2` to `10g-4` are access ports, each in one VLAN. A device plugged into one of them does not know VLANs exist.
- The switch has one address of its own, on `mgmt`, so you can log in to it, and a default route to the router, its gateway.
- `lldp: true` lets the switch tell its neighbors who it is. `stp: { edge: true }` marks a port with a single device on it, so the port comes up at once instead of waiting; the Intermediate level explains why a switch waits.

## router.ts

<<< @/../templates/single-site/router.ts

Each part of it is a lesson of this level:

- **`25g-1`** is the other end of the trunk, with the same three VLANs and a `link` back ([Trunks](/academy/elementary/trunks)).
- **`interfaces`** gives the router an address on each VLAN, the gateway for that VLAN, and **`dhcp`** hands out addresses, the gateway and the DNS server to every device that joins ([DHCP](/academy/elementary/dhcp)).
- **`1g-1`** holds the public address from your provider, and the static route sends everything that is not at home to the provider. Change both to what your provider gave you.
- **`system.dns`** with `serve: true` lets the router answer DNS questions, which is why the input firewall accepts DNS from home and guests.
- **`firewall.filter`** decides what may pass, to the router and through it ([Firewalls](/academy/elementary/firewall)), and **`firewall.nat`** shares the public address ([NAT](/academy/elementary/nat)).
- **`users`**, **`management`** and **`secret`** keep the keys ([Keeping the keys](/academy/elementary/management)).

## checks.ts and circuit.config.ts

<<< @/../templates/single-site/checks.ts

Two rules Circuit cannot know on its own: every port has a description, which is a warning, and no access port gives the management VLAN to whatever plugs in, which is an error.

<<< @/../templates/single-site/circuit.config.ts

`circuit.config.ts` lists every device Circuit manages, and the checks. Every command starts by reading it. A network without BGP needs nothing more.

## Fix what validate finds

`npx circuit validate` checks every file, the two ends of every cable, and your checks. Your editor catches some mistakes before that, such as a VLAN name that does not exist. Here are five mistakes that are easy to make while you change the template to your own.

<TryIt title="Fix the files">

Each mistake below was made in the single-site template, one at a time, and `circuit validate` was run on it: what you see is what it printed. Find the mistake, run validate, read what it says, and pick the fix.

<FixTheSite />

</TryIt>

Look at how each message points at its cause. A trunk that carries different VLANs at its two ends is reported from both ends, with the VLAN numbers. The rule from `checks.ts` speaks in your own words, because you wrote it. And an address used twice names both devices that hold it.

An error stops `diff` and `apply`, so none of these can reach a device. A warning, like the port without a description, is printed and stops nothing.

<Quiz
  question="validate prints one warning and no errors. You run npx circuit diff. What happens?"
  :choices="['diff refuses to run until the warning is gone', 'diff prints the warning and then the plan', 'diff runs, and the warning is sent to the device']"
  :answer="1"
  :why="['Only an error stops diff and apply. A warning is there for you to read.', '', 'Nothing about a warning is sent to a device. It is only printed.']"
  explain="A warning is printed and nothing is stopped. Only an error stops diff and apply."
/>

<Quiz
  question="Which part of the files keeps a guest phone from reaching the printer on the home VLAN?"
  :choices="['The access ports in switch.ts, which put them in different VLANs', 'The forward chain in router.ts, which drops guests going to home', 'The DHCP pool for guests in router.ts']"
  :answer="1"
  :why="['Different VLANs keep them apart on the switch, but the router joins the VLANs. Without a rule, it would pass the packet from one to the other.', '', 'DHCP hands out addresses. It decides nothing about where a device may go.']"
  explain="The VLANs send every packet between guests and home through the router, and its forward chain drops it there."
/>

## From the files to the devices

With the files right, the rest is a handful of commands. Step through them: the output shown is what Circuit printed for this template, and the commands that need a real device to answer are shown without output.

<TryIt title="From an empty folder to a change">

<SiteCommands />

</TryIt>

1. **`secrets`** checks that every password the files name can be read, before anything logs in.
2. **`validate`** checks the files.
3. **`snapshot`** reads what each device runs now into `.circuit/state/`. It changes nothing.
4. **`diff`** compares your files with that snapshot, offline. It is fast and safe, but it does not know about anything changed on a device after the snapshot.
5. **`apply`** reads the device again, shows the plan against what it runs right now, and with `--confirm` sends it, logs in again, and saves a new snapshot.

Apply the switch first, then the router, as the [pattern's page](/patterns/single-site) suggests.

::: danger The first plan is long
A device that was set up by hand runs many things your files do not describe yet. The first plan removes all of them, because the file is the whole truth. Read it line by line, and add to the file whatever must stay, until the plan only holds changes you want.
:::

<Quiz
  question="You ran snapshot yesterday. This morning a colleague changed the switch by hand. You run npx circuit diff switch. What does it compare your files with?"
  :choices="['What the switch runs right now, including the colleague’s change', 'Yesterday’s snapshot, without the colleague’s change', 'Nothing: diff needs a new snapshot every day']"
  :answer="1"
  :why="['diff never logs in. It only reads the last snapshot.', '', 'diff works with whatever snapshot there is, however old.']"
  explain="diff compares with the last snapshot and never logs in. apply always reads the device again first, so its plan includes the colleague’s change."
/>

Commit the device files together with `.circuit/` after every apply. Git then holds the history of your network: what each device was told to run, and what it ran afterwards.

## In short

| Lesson                                                        | Where it is in the project                                            |
| ------------------------------------------------------------- | --------------------------------------------------------------------- |
| [Layers](/academy/elementary/layers)                          | the switch moves frames inside VLANs, the router routes between them  |
| [Writing a network down](/academy/elementary/writing-it-down) | one file per device, `validate`, `diff`, `apply`, and git for history |
| [VLANs](/academy/elementary/vlans)                            | `vlans` in `site.ts`, `access_vlan` on the switch's ports             |
| [Trunks](/academy/elementary/trunks)                          | `trunk_vlans` and `link` on `10g-1` and `25g-1`                       |
| [DHCP](/academy/elementary/dhcp)                              | the router's `interfaces` of type `vlan`, and `dhcp`                  |
| [NAT](/academy/elementary/nat)                                | `firewall.nat.source`                                                 |
| [Firewalls](/academy/elementary/firewall)                     | `firewall.filter.input` and `forward`                                 |
| [Keeping the keys](/academy/elementary/management)            | `users`, `management`, `secret()`, and the check in `checks.ts`       |

- Start from `npx @takodotid/circuit new my-network --pattern single-site`, and change `site.ts` first.
- `validate` catches mismatched trunks, missing names, addresses used twice and your own rules; an error stops every change.
- `snapshot` reads, `diff` compares offline, `apply` reads again and sends only with `--confirm`.
- Commit the files and `.circuit/` together after every apply.
