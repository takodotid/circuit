---
description: Circuit keeps one TypeScript file per network device, shows what would change on the device, and makes it match.
---

# Introduction

Circuit lets you write down how each network device should be set up. Then it makes the device match.

You keep one TypeScript file per device in a git repository. Circuit reads the files and what each device runs, shows you the difference, and sends the change once you say yes. If you know Terraform or Ansible for servers, Circuit is the same idea for routers and switches.

<FlowDiagram />

## How it works

1. You describe a device in a file: its ports, VLANs, addresses, routing, firewall, and more. Your editor checks every name as you type.
2. `circuit validate` checks the whole project.
3. `circuit diff <device>` reads the device and shows what would change on it.
4. `circuit apply <device>` shows the same, asks, and sends the change once you say yes. Circuit keeps the change only if it can still log in afterwards. See [Make a change](/guide/apply).
5. You commit the files. Git keeps the history of your network: who changed what, when, and why.

## Principles

1. **The file is the whole truth.** A device runs exactly what its file says. Circuit turns off a port the file doesn't write, removes a user it doesn't list, and turns off a service it doesn't turn on.
2. **Leave a field out to turn it off.** You write only what is on. There is no `enabled: false`.
3. **The same words for every vendor.** You write `access_vlan` or `ssh`, and each device gets its own vendor's commands. If a device can't do what you wrote, `circuit validate` says so, and Circuit sends nothing.
4. **Names are checked as you type.** Every VLAN, interface, policy, and port you use must exist on that device. Your editor shows a typo as an error.
5. **Nothing is filled in for you.** Circuit writes no default and no description that you didn't write. It may warn, but it never fills in.
6. **Secrets are encrypted.** A password is `secret("NAME")` in the file. Its value is encrypted in `.circuit/secrets`, and Circuit decrypts it only when a command needs it, such as `diff` or `apply`. See [Secrets](/guide/secrets).
7. **Standards first.** What Circuit ships, such as BGP roles or the bogon list, follows an RFC, IANA, or another published source. See [Standards](/reference/standards). Your network's own choices stay in your project.

## Which devices

Circuit works with MikroTik RouterOS, Huawei VRP, Raisecom ROS, Juniper Junos, and Fortinet FortiOS. See [Platforms](/reference/platforms) for the versions and what works on each.

Next, [install Circuit](/guide/install). If some words are new to you, see the [Glossary](/reference/glossary).
