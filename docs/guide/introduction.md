# Introduction

Circuit lets you write down how your network should be configured, and then makes your devices match it.

Instead of logging in to each router and switch and typing commands, you keep one TypeScript file per device in a git repository. Circuit reads those files, compares them with what each device runs, shows you the difference, and sends the change when you confirm it.

If you have used Terraform or Ansible for servers, this is the same idea for network gear. If you have not, the next pages explain everything you need.

## How it works

1. You describe a device in a file: its VLANs, ports, addresses, routing, firewall and so on.
2. `circuit diff` shows what would change on the device, without touching it.
3. `circuit apply <device>` logs in to the device, reads what it runs, and shows the exact plan.
4. `circuit apply <device> --confirm` sends the plan. The change is kept only after Circuit can log in again; see [How a change is applied](/guide/convergence).
5. You commit the file. Git now holds the history of your network: who changed what, when, and why.

## What Circuit believes

1. **The file is the whole truth.** A device runs exactly what its file says. A port the file does not mention is shut down, a user it does not list is removed, a service it does not turn on is off. Nothing is left alone because nobody wrote it down.
2. **Leave a field out to turn it off.** You only write what is on. There is no `enabled: false`.
3. **The same words for every vendor.** You write `access_vlan`, `ssh` or `hardware_offload`, and each device gets its own vendor's commands. When a device cannot do something you wrote, `circuit validate` says so, with the reason, and nothing is sent.
4. **Names are checked as you type.** Every VLAN, interface, policy and port you refer to must exist on that device. A typo is an error in your editor, before it is ever sent.
5. **Secrets stay out of the files.** A password is written as `secret("NAME")`, and its value comes from `.env` or 1Password only when a command is sent. Plans and snapshots never hold a secret.

## Which devices

Circuit supports MikroTik RouterOS 7, Huawei VRP and Raisecom ROS. Each was proved on production devices before it was released. See [Platforms](/platforms/) for what each one can do.

New to some of the words here? See [Words used here](/guide/glossary).
