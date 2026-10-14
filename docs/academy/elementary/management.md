---
title: Keeping the keys
description: Whoever can log in to a router controls the network. Decide who may log in, from where and how, keep passwords out of the files, and never lock yourself out.
---

# Keeping the keys

Whoever can log in to a router or a switch controls your network: they can read what passes through it, open its firewall, or turn it off. So a device should answer logins only from the management network, only over SSH, and only for the users its file lists. Its passwords live outside the files, in `.env` or a password manager, and the files only name them.

## Three locks on the door

The management network is a VLAN that only the people who run the network use. In the single-site network it is `mgmt`, VLAN 10, `192.168.10.0/24`, and it travels only on the trunk between the switch and the router. The three locks are all written in the device's file:

1. **Where from.** `management.allow` lists the addresses that may reach the device's services. A computer outside it does not even get a login prompt.
2. **How.** Each way in is a service, and a service is on only when it is written: `ssh: {}` turns SSH on. Telnet, plain web (`http`) and the rest stay off unless you write them. <Term means="Secure shell: a way to log in to a device over the network, with everything encrypted, the password included.">SSH</Term> is encrypted. Telnet and plain web send your password across the network as readable text, so anyone on the path can read it.
3. **Who.** `users` lists every login, each with a role. `admin` may do everything, `read-only` may look but change nothing, and `operator` sits between the two; exactly what it may do differs by platform. A user the file does not list is removed from the device.

```ts
connection: { host: ROUTER, user: "operator" },
users: { operator: { role: "admin", password: secret("ROUTER_PASSWORD") } },
management: { allow: [MANAGEMENT], ssh: {} },
```

`connection` is how Circuit itself logs in: the address, and which of `users` it logs in as. Circuit is just another SSH login, held to the same locks.

<TryIt title="Who gets in?">

Seven attempts to log in to the router, and what happens to each with the settings as they are. Change the services, the allowed sources, the users and one switch port until every attempt ends the way it should. To show what each lock does on its own, this router has no input firewall in front of its services.

<LoginGate />

</TryIt>

Each lock stopped someone different. The allowed sources stopped the guest phone, the stranger and the visitor on the guest network, whatever password they tried. Turning telnet off stopped the old script, which was sending your password in plain text. Only removing the intern's user stopped the intern, who was sitting on the management network with a password that still worked.

On a real router, the input firewall from [Firewalls](/academy/elementary/firewall) is a fourth lock on the same door: the single-site router's "Management" rule accepts only `192.168.10.0/24` too. Two locks that say the same thing are not wasted. If one of them is ever changed by mistake, the other still holds.

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

The device files go into git, and git keeps every version forever, for everyone who can read the repository. So a password is never written in a file. You write `secret("ROUTER_PASSWORD")`, a name, and Circuit looks up the value only at the moment it sends a command to the device. It looks in two places, in this order:

1. The environment, such as a variable set in your terminal or by an automated job.
2. `.env`, next to `circuit.config.ts`. `circuit new` creates it with one empty line per password, and keeps it out of git.

```bash
# .env
ROUTER_PASSWORD=correct-horse-battery-staple
```

A line in `.env` can also point at a password manager instead of holding the password, such as `ROUTER_PASSWORD=op://Network/router/password` for 1Password. See [Secrets](/guide/secrets).

Plans, `build` output and snapshots never hold the value. Where the password goes, `npx circuit build router` prints only its name:

```text
add group=full name=operator password="<secret:ROUTER_PASSWORD>"
```

And a password typed into the file as plain text is an error in your editor, before anything is run:

```text
Type 'string' is not assignable to type 'Secret'.
```

`npx circuit secrets` lists every secret the files name, and whether each can be read, without printing any of them. With `ROUTER_PASSWORD` in `.env` and `SWITCH_PASSWORD` forgotten:

```text
  ok       ROUTER_PASSWORD, from .env
  missing  SWITCH_PASSWORD: secret SWITCH_PASSWORD is not set in the environment or in .env

2 secret(s), 1 missing.
```

A device never shows its passwords back, so Circuit cannot see that one changed. To change a password, change it in `.env` or the password manager, then run `npx circuit apply router --secrets --confirm`.

<Quiz
  question="Where does the router’s password belong?"
  :choices="['In router.ts, next to the user it belongs to', 'In .env or a password manager, with router.ts naming it through secret', 'In the snapshot in .circuit/state/, which Circuit writes']"
  :answer="1"
  :why="['router.ts goes into git, and git keeps it forever for everyone who can read the repository. Your editor also marks a plain password as an error.', '', 'Snapshots never hold a secret. Circuit removes them before it writes one.']"
  explain="The file names the secret, and its value lives in .env or a password manager, outside git. Circuit reads it only when it sends a command."
/>

## Keep management off the wall sockets

The management VLAN should only travel on trunks between devices. If an access port is in it, whoever plugs into that socket is on the management network, and the first lock lets them through. You saw this with the visitor in the widget.

Circuit cannot know which of your VLANs is the management one, so the single-site pattern says it in a check of its own, in `checks.ts`:

```ts
// Someone plugging into a wall socket must not land on the management network. Only a trunk between devices carries it.
(devices) =>
    devices.flatMap((device) =>
        Object.entries(device.ports ?? {})
            .filter(([, port]) => port?.access_vlan && vlansOf(port).includes("mgmt"))
            .map(([name]) => ({
                level: "error" as const,
                device: device.name,
                message: `port ${name} gives management to whatever plugs in`,
            }))
    ),
```

For every device, it finds each access port whose VLAN is `mgmt`, and reports it as an error. Put the guest access point's port on `mgmt` and `npx circuit validate` says:

```text
  error  switch: port 10g-4 gives management to whatever plugs in

1 error(s).
```

An error stops `diff` and `apply`, so the mistake never reaches the switch. More on checks in [The network](/guide/network#checks).

## Locking yourself out

The most dangerous change is one that cuts off the way in: turning SSH off, narrowing `management.allow` so it leaves out your own computer, or removing the user Circuit logs in as. `validate` catches the last one, because it can see the file. Rename the router's `operator` user to `admin`, and it says:

```text
  error  router: connection user 'operator' is not one of its users

1 error(s).
```

It cannot catch the first two, because it does not know where your computer is or how you meant to log in. Turning SSH off in the single-site router validates with no errors, and its whole plan is one line:

```text
router: 1 command(s) in 1 step(s)
  /ip service
    ~ set ssh disabled=yes address=
```

So Circuit protects you when it applies. After every change it logs in again, in a new session, and the change is kept for good only if that login works.

<TryIt title="Apply a change safely">

Step through how Circuit applies a change to a RouterOS router. Then pick the change that turns SSH off and step through it again.

<SafeApply />

</TryIt>

What happens when the new login fails depends on the platform, as [How a change is applied](/guide/convergence) explains. A RouterOS router loads its backup on its own after 10 minutes, or the minutes you give `--rollback`. A Junos switch does the same on its own, after the same minutes. Huawei VRP and Raisecom do not save the change until the login works, so restarting the device brings back the configuration it had before.

<Quiz
  question="You apply a change to a RouterOS router that narrows management.allow, and your computer is no longer in it. What happens?"
  :choices="['The change stays, and someone has to go to the router', 'Circuit cannot log in again, and after 10 minutes the router loads its backup', 'validate refuses the change before it is sent']"
  :answer="1"
  :why="['That is what the backup and its timer are for: the router undoes the change by itself.', '', 'validate does not know where your computer is, so it accepts the change. The protection comes when Circuit applies it.']"
  explain="Circuit logs in again after every change. When that fails, the timer it set before sending runs out, and the router loads the backup it saved."
/>

## In short

- Whoever can log in to a device controls the network, so lock the door three ways: where from (`management.allow`), how (SSH only), and who (`users`, where anyone not listed is removed).
- Passwords never go in the files: write `secret("NAME")`, and keep the value in `.env` or a password manager.
- A check of your own in `checks.ts` keeps the management VLAN off access ports, and an error stops the change.
- `validate` cannot always see a change that locks you out, so Circuit logs in again after every change, and keeps it only if that works.
