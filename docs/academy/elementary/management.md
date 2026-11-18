---
title: Keeping the keys
description: Whoever can log in to a router controls the network. Decide who may log in, from where and how, keep passwords out of the files, and never lock yourself out.
---

# Keeping the keys

Whoever can log in to a router or a switch controls your network: they can read what passes through it, open its firewall, or turn it off. So a device should answer logins only from the management network, only over SSH, and only for the users its file lists. Its passwords stay out of the files, encrypted in `.circuit/secrets` or in a password manager. The files only give their names.

## Three locks on the door

The management network is a VLAN that only the people who run the network use. In the single-site network it is `mgmt`, VLAN 10, `192.168.10.0/24`, and it travels only on the trunk between the switch and the router. The three locks are all written in the device's file:

1. **Where from.** `management.allow` lists the addresses that may reach the device's services. A computer that is not on the list does not even get a login prompt.
2. **How.** Each way in is a service, and a service is on only when it is written: `ssh: {}` turns SSH on. Telnet, plain web (`http`), FTP, and the rest stay off unless you write them. SSH is encrypted. Telnet, FTP, and plain web send your password across the network as readable text, so anyone on the path can read it.
3. **Who.** `system.users` lists every login, each with a role. `admin` may do everything, `read-only` may look but change nothing, and `operator` sits between the two. Exactly what `operator` may do differs by platform. A user the file does not list is removed from the device.

```ts
connection: { host: "192.168.10.1", user: "operator" },
system: {
    users: { operator: { role: "admin", password: secret("ROUTER_PASSWORD") } },
},
management: { allow: [home.addresses.management], ssh: {} },
```

`connection` is how Circuit itself logs in: the address, and which of `system.users` it logs in as. Circuit logs in over SSH like anyone else, and the same locks apply to it.

<TryIt title="Who gets in?">

To show what each lock does on its own, this router has no input firewall in front of its services.

<LoginGate />

</TryIt>

Each lock stopped someone different. The allowed sources stopped the guest phone, the stranger, and the visitor on the guest network, whatever password they tried. Turning telnet off stopped the old script, which was sending your password in plain text. Only removing the intern's user stopped the intern, who was sitting on the management network with a password that still worked.

On a real router, the input chain from the [firewall](/academy/elementary/firewall) lesson is a fourth lock on the same door. The single-site router's "Management" rule accepts only `192.168.10.0/24` too. Two locks that say the same thing are not wasted: if one of them is changed by mistake, the other still keeps people out.

Removing a user is a change like any other, so Circuit shows it in the plan. Here someone had added a user called `intern` to the router by hand, and the file does not list it:

```text
router: 1 command(s) in 1 step(s)
  /user
    - add group=full name=intern
```

<Quiz
  question="management.allow is 192.168.10.0/24. Your laptop is on the home VLAN, 192.168.20.10. Can it log in to the router over SSH?"
  :choices="['Yes, with the right password', 'No: the router does not answer it at all', 'Only as a read-only user']"
  :answer="1"
  :why="['The password is never asked for. 192.168.20.10 is not in 192.168.10.0/24, so the router does not answer.', '', 'Roles decide what a user may do once logged in. This laptop never gets that far.']"
  explain="192.168.20.10 is outside the allowed prefix, so the router does not answer it. Move the laptop to the management VLAN to log in."
/>

## Passwords stay out of the files

The device files go into git, and git keeps every version forever, for everyone who can read the repository. So a password is never written in a file. You write `secret("ROUTER_PASSWORD")`, a name. Circuit reads the value only when a command needs it, such as `diff` or `apply`. It looks in two places, in this order:

1. The environment, such as a variable set in your terminal or by an automated job.
2. `.circuit/secrets`, in the project's folder, where each value is encrypted. One password opens it, and that password is never in git.

```bash
circuit secrets set ROUTER_PASSWORD
```

Circuit asks for the password without showing it, encrypts it, and writes it to `.circuit/secrets`. The first time, it asks you to choose the password that opens the file. Keep that one in your password manager. A value can also point to a password manager instead, such as `op://Network/router/password` for 1Password. See [Secrets](/guide/secrets).

A password typed into the file as plain text is an error in your editor, before anything is run:

```text
Type 'string' is not assignable to type 'Secret'.
```

`circuit secrets list` shows every secret the files use, and how each is kept, without printing any of them. With `ROUTER_PASSWORD` set and `SWITCH_PASSWORD` forgotten:

```text
┌─────────────────┬──────────────────────────────┐
│ Name            │ How it is kept               │
├─────────────────┼──────────────────────────────┤
│ ROUTER_PASSWORD │ encrypted                    │
│ SWITCH_PASSWORD │ missing, the config needs it │
└─────────────────┴──────────────────────────────┘
```

A device never shows its passwords back, so Circuit cannot see that one changed. To change a password, set it again with `circuit secrets set ROUTER_PASSWORD`, then run `circuit apply router --secrets`. The plan sends the password again, and shows only its name:

```text
router: 1 command(s) in 1 step(s)
  /user
    ~ {"name":"operator"} password=<secret:ROUTER_PASSWORD>
```

<Quiz
  question="Where does the router’s password belong?"
  :choices="['In router.ts, next to the user it belongs to', 'In .circuit/secrets, encrypted, and router.ts gives only its name, with secret', 'In .circuit/types, which Circuit writes']"
  :answer="1"
  :why="['router.ts goes into git as you wrote it, and git keeps it forever for everyone who can read the repository. Your editor also marks a plain password as an error.', '', 'That folder holds what your editor reads. Circuit writes it again whenever it is updated, and it never holds a secret.']"
  explain="The file gives only the name of the secret. Its value is in .circuit/secrets, encrypted, and the password that opens it stays out of git. Circuit reads the value only when a command such as diff or apply needs it."
/>

## Keep management off the wall sockets

The management VLAN should only travel on trunks between devices. If an access port is in it, whoever plugs into that socket is on the management network, and the first lock lets them through. You saw this with the visitor in the widget.

Circuit cannot know which of your VLANs is the management one. So the [single-site example](/guide/examples#a-single-site) says it in a check of its own, in `lib/checks.ts`, and turns it on in `circuit.ts`:

```ts
// lib/checks.ts
import type { Check } from "circuit";

/** Someone who plugs into a wall socket must not land on the management network: only a trunk between devices carries it. */
export const managementStaysOnTrunks: Check = (network) =>
    network.devices.flatMap((device) =>
        Object.entries(device.interfaces?.ethernet ?? {})
            .filter(([, port]) => port?.access_vlan === "mgmt")
            .map(([name]) => ({
                device: device.name,
                path: `interfaces.ethernet.${name}`,
                message: "gives management to whatever plugs in. Put the port in another VLAN.",
            }))
    );
```

```ts
// circuit.ts
checks: {
    same_vlan_ids: true,
    management_stays_on_trunks: managementStaysOnTrunks,
},
```

For every device, the check finds each access port whose VLAN is `mgmt`, and reports it as an error. Put the guest access point's port on `mgmt`, and `circuit validate` gives the file and line of the port:

```text
sites/home/switch.ts:30: management_stays_on_trunks: switch: interfaces.ethernet.10g-4: gives management to whatever plugs in. Put the port in another VLAN.

1 error(s).
```

An error stops `diff` and `apply`, so the mistake never reaches the switch. More on checks in [Checks and errors](/guide/checks).

## Locking yourself out

The most dangerous change is one that cuts off the way in. You might turn SSH off, narrow `management.allow` so it leaves out your own computer, or remove the user Circuit logs in as. `validate` catches the last one, because it can see the file. Rename the router's `operator` user to `admin`, and it says:

```text
router: connection.user: no user operator

1 error(s).
```

It cannot catch the first two, because it does not know where your computer is or how you meant to log in. Turning SSH off in the single-site router validates with no errors, and its whole plan is one line:

```text
router: 1 command(s) in 1 step(s)
  /ip service
    ~ set ssh disabled=yes address=
```

So Circuit protects you when it applies. After every change, it logs in again in a new session, and keeps the change only if that login works.

<TryIt title="Apply a change safely">

Step through how Circuit applies a change to a RouterOS router. Then pick the change that turns SSH off, and step through it again.

<SafeApply />

</TryIt>

What happens when the new login fails depends on the platform. [Make a change](/guide/apply#not-locking-you-out) says what each platform does.

<Quiz
  question="You apply a change to a RouterOS router that narrows management.allow, and your computer is no longer in it. What happens?"
  :choices="['The change stays, and someone has to go to the router', 'Circuit cannot log in again, and after 10 minutes the router loads its backup', 'validate refuses the change before it is sent']"
  :answer="1"
  :why="['That is what the backup and its timer are for: the router undoes the change by itself.', '', 'validate does not know where your computer is, so it accepts the change. The protection comes when Circuit applies it.']"
  explain="Circuit logs in again after every change. When that fails, the timer it set before sending runs out, and the router loads the backup it saved."
/>

## In short

- Whoever can log in to a device controls the network, so lock the door three ways: where from (`management.allow`), how (SSH only), and who (`users`, where anyone not listed is removed).
- Passwords never go in the files. Write `secret("NAME")`, and set the value with `circuit secrets set NAME`, encrypted in `.circuit/secrets`.
- A check of your own in `lib/checks.ts` keeps the management VLAN off access ports, and an error stops the change.
- `validate` cannot always see a change that locks you out, so Circuit logs in again after every change, and keeps it only if that works.
