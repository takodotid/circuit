# Introduction

Circuit lets you write down how each network device should be configured, and then makes the device match.

You keep one TypeScript file per device in a git repository. Circuit reads the files, reads what each device runs, shows you the difference, and sends the change once you say yes. If you know Terraform or Ansible for servers, this is the same idea for routers and switches.

<FlowDiagram />

## How it works

1. You describe a device in a file: its ports, VLANs, addresses, routing, firewall and the rest. Your editor checks every name as you type.
2. `circuit validate` checks the whole project.
3. `circuit diff <device>` reads the device and shows what would change on it.
4. `circuit apply <device>` shows the same, asks, and sends the change once you say yes. The change is kept only when Circuit can still log in afterwards: see [How a change is applied](/guide/apply).
5. You commit the files. Git holds the history of your network: who changed what, when, and why.

## What Circuit believes

1. **The file is the whole truth.** A device runs exactly what its file says. A port the file doesn't write is turned off, a user it doesn't list is removed, a service it doesn't turn on is off.
2. **Leave a field out to turn it off.** You write only what is on. There is no `enabled: false`.
3. **The same words for every vendor.** You write `access_vlan` or `ssh`, and each device gets its own vendor's commands. When a device can't do what you wrote, `circuit validate` says so, and nothing is sent.
4. **Names are checked as you type.** Every VLAN, interface, policy and port you name must exist on that device. A typo is an error in your editor.
5. **Nothing is filled in for you.** Circuit writes no default and no description you didn't write. It may warn, never fill in.
6. **Secrets are encrypted.** A password is `secret("NAME")` in the file. Its value is in `.env`, encrypted, and read only when a command is sent. See [Secrets](/guide/secrets).

## Which devices

MikroTik RouterOS 7, Huawei VRP V200R005, Raisecom ROS 6.5, Juniper Junos 21 and Fortinet FortiOS 6.2. Each was proved on a real device. See [Platforms](/platforms/) for what each one can do.

Next: [Install Circuit](/guide/install). New to some of the words? See the [Glossary](/guide/glossary).
