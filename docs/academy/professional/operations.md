---
title: Running it day to day
description: Take a change from request to device through review, handle an incident when one comes anyway, and keep racks, cables and addresses written down.
---

# Running it day to day

Running a network day to day is three jobs: changing it without breaking it, fixing it fast when it breaks anyway, and knowing at all times what you have. Most days are about the first one: customers ask for ports, new networks join, prefixes change, and each of those is a change to a device that carries other people's traffic.

With Circuit, a change is a change to a file, so it can go through the same steps as a change to software: a branch, a plan anyone can read, a second person who reviews it, and a record in git of who did what and why.

## A change, from request to device

Every change follows the same steps, whatever its size:

1. **A request** that someone can point to later: who asked, for what, by when. Usually a <Term means="A numbered record of a request or a problem, where everyone involved writes what they did, so the history stays in one place.">ticket</Term>.
2. **A branch** in git, so nothing reaches `main`, or a device, before review.
3. **The change** to the files, and `npx circuit validate`.
4. **The plan**: `npx circuit diff` against the last snapshot.
5. **A pull request** with the request linked and the plan pasted in.
6. **Review** by someone else.
7. **A window**: a time agreed in advance with whoever the change can touch.
8. **Apply**: `npx circuit apply <device>`, read the plan, then `--confirm`.
9. **Check** that it works, and commit the new snapshot.

<TryIt title="Walk one change through">

A tenant of the [colocation](/patterns/colocation) asks for a port for a third server. Step through the change, from the ticket to the commit. Everything Circuit prints here is its own output, run on the template.

<ChangeWalk />

</TryIt>

The diff and the plan from `apply` are the same comparison, made against different things. `diff` compares your files with the last snapshot, offline, so the reviewer can read it days before the window. `apply` reads the device again first. If, in the window, the plan from `apply` is longer than the one in the pull request, the device changed after the snapshot, most likely by hand. Stop and find out why before you confirm: the file is the whole truth, so whatever someone added by hand is about to be removed.

Merging first, as in the walk above, means `main` says what the network should run; applying from the branch and merging afterwards means `main` says what it does run. Either works if the gap between the two is no longer than the window, and the snapshot is committed after every apply.

## Reviewing a change

A reviewer is not there to check the spelling of a VLAN name; `circuit validate` does that, and <Term means="Continuous integration: a service that runs checks, such as circuit validate, on every pull request and shows whether they passed.">CI</Term> can run it on every pull request. A reviewer reads the plan and asks what a computer cannot:

- **Does validate pass?** If not, there is nothing to review yet.
- **Does the plan do only what the request asks?** Look hardest at the lines that start with `-`: something that exists now is going away.
- **Who notices, and when?** That decides the window, and who must be told.
- **How is it undone?** Usually by reverting the commit and applying again. If the answer is harder than that, the change needs a plan of its own.

<TryIt title="Review three pull requests">

Read each request, the file, CI's result and the plan. Ask the reviewer's questions, then approve or ask for changes.

<ChangeReview />

</TryIt>

The second pull request would have taken a paying customer's server off the network: `10g-1` is acme server 1's port, and a port given to two tenants goes to the last one alone. The template's check catches it, so `validate` stops it before anyone reads a plan. Not every mistake has a check written for it, though. When one does not, the plan shows it in plain words, on its `-` lines. A valid file is not always the change you meant, and that is what review is for.

Studio helps the reviewer see the change as a network, not as text. Its [Compare](/studio/changes) sets your files beside another branch, a tag or a commit: each device's config then and now, line by line, the lines of the graph that are added or gone, and what `validate` finds newly. Compare the pull request's branch with `main` before you approve it.

<Quiz
  question="CI passed and the plan for tor-01 shows an interface losing two VLANs that belong to a tenant who did not ask for anything. What do you do?"
  :choices="['Approve: CI passed, so the change is safe', 'Ask for changes, and ask the author which port the request meant', 'Approve, and tell the tenant afterwards']"
  :answer="1"
  :why="['CI runs the checks someone wrote. A plan can still have a change that no check was written for.', '', 'The tenant would find out first, when its server drops off the network.']"
  explain="A minus line on something that belongs to someone else is exactly what review is for. The file is valid, but it is not the change the request asked for."
/>

## The window and the way back

A change that can touch customers goes out in a <Term means="A time agreed in advance, usually at night or early morning when traffic is low, when planned work may interrupt service.">maintenance window</Term>: a time when traffic is low, announced in advance to whoever can notice. How far in advance is a matter of contract. One exchange, for example, announces its windows at least seven days ahead, and plans them for off-peak hours, often late at night or early in the morning. An emergency, such as a fix for an outage in progress, skips the wait but is still written down and announced as one.

In the window, apply one device at a time, starting where a mistake hurts least, and check each before the next. Circuit protects you while it applies (see [How a change is applied](/guide/convergence)):

1. It dry-runs the plan where the platform allows it: RouterOS compiles every command without running it, VRP loads every line into a candidate that is thrown away if the device refuses one, and Junos loads the plan into a candidate and checks it with `commit check` before anything changes. FortiOS and Raisecom ROS run each line as it is sent; if a FortiGate refuses one, Circuit has it reload its saved config, which undoes what was sent.
2. After the change, it logs in again in a new session. The change is kept only once that login works.
3. If it cannot log in again, a RouterOS device restores its backup by itself after `--rollback` minutes, 10 by default. A VRP or Raisecom device has not saved the change, so a restart brings back the last saved config. On Junos and FortiOS, Circuit undoes the change over the session that is still open: Junos goes back to the previous config, and a FortiGate reloads its saved one. If Circuit cannot do that either, the device does it by itself after `--rollback` minutes.

That protects your access, not your customers. The way back for anything else is the way forward: revert the commit, and apply again.

<Quiz
  question="In the window, npx circuit apply tor-01 shows a plan of 40 lines. The plan in the pull request had 7. What do you do?"
  :choices="['Confirm: apply always reads the device, so its plan is the right one', 'Stop, and find out what changed on the switch since the snapshot', 'Run circuit diff again until it shows 40 lines too']"
  :answer="1"
  :why="['It is the right plan for the switch as it is now, but 33 of its lines were never reviewed. Something changed on the device that nobody wrote down.', '', 'diff compares with the old snapshot. It never logs in, so it will keep showing 7.']"
  explain="apply reads the device again, so the extra lines are changes made after the snapshot, probably by hand. Confirming would remove them unreviewed. Find out what they are first."
/>

## When it breaks

Something will break anyway: a fibre is cut, a device fails, a change does something nobody expected. Large networks keep a <Term means="Network operations centre: the people, often working in shifts, who watch the network and answer when it breaks.">NOC</Term>, a team that watches the network around the clock; smaller ones have an engineer <Term means="Being the person who must answer alerts and calls outside working hours, for a set week or shift.">on call</Term>. Either way, an outage goes better with a few rules agreed before it starts. Google's book on running large systems gives these:

1. **Declare an incident early.** It is one if a second team must help, if customers can see it, or if an hour of focused work has not solved it. Closing a small one quickly costs little.
2. **One person runs it**, the incident commander, who decides and hands out the work. The people fixing it are the only ones changing anything.
3. **One person talks to everyone else**, customers included, with regular updates.
4. **Keep a live document**: what is known, what was tried, who is doing what, the most important part at the top.
5. **Afterwards, write a postmortem** without blame: the impact, what was done, the causes, and what will stop it happening again.

If a change went out just before the trouble began, undo it first and ask why afterwards. That is one more reason to keep every change small, written down, and easy to revert.

A real outage shows how much the rest matters. On 4 October 2021, during routine maintenance, a command meant to assess the capacity of Facebook's backbone disconnected every link of it. A tool that audits such commands should have stopped it, but had a bug. Their DNS servers, which stop announcing their routes when they cannot reach the data centres, withdrew them, so nobody outside could find any of the company's services. The <Term means="A separate path to manage devices, such as a separate network or a console line, which keeps working when the main network does not.">out-of-band</Term> network was down too, so engineers had to travel to the data centres, and they then brought services back in stages, because switching everything on at once could itself have overloaded power and systems. Every safeguard in this lesson appears in that story: a check before the change, a way in that does not depend on the network, and a careful way back.

## Keeping the plant written down

You cannot run what you cannot find. A provider keeps three records besides the configs:

- **<Term means="Data centre infrastructure management: the record of racks, what is mounted where, power feeds, and every cable from one port to another.">DCIM</Term>**: racks, what is mounted in which unit, power feeds, and every cable from end to end.
- **<Term means="IP address management: the record of which prefixes and addresses are used where, and which are free.">IPAM</Term>**: every prefix and address, who has it, and what is free.
- **Capacity**: how full each port, link and device is, from the monitoring in [Watching the network](/academy/professional/monitoring), so an upgrade is ordered before a link fills, not after.

Circuit already has part of this. The files know every device, port, cable (`link`), VLAN and address, and `circuit addresses` lists what is used and free in each block. On the colocation pattern:

```
$ npx circuit addresses 198.51.100.0/24
198.51.100.0/24, originated by edge-01
  198.51.100.8/29, 5 free, next 198.51.100.10
      198.51.100.9  edge-01 acme-internet
  free: 198.51.100.0/29, 198.51.100.16/28, 198.51.100.32/27, 198.51.100.64/26, 198.51.100.128/25
```

What Circuit does not know is the physical plant: racks, power, serial numbers, which building a device is in. Many networks keep that in [NetBox](https://netboxlabs.com/docs/netbox/), which describes itself as a source of truth that combines IPAM and DCIM. A way to keep NetBox in step with your config, one way, with Circuit writing and NetBox showing, is planned in [issue #24](https://github.com/takodotid/circuit/issues/24) but not built: NetBox needs a site, a role and a type for each device, which Circuit's config does not have yet.

Some upkeep runs on a timer instead of a request. Prefix lists built from a registry change every day, and [Scheduled refresh](/guide/scheduled-refresh) puts the current ones on the device every night, with `circuit refresh`.

## Further reading

- [Managing Incidents](https://sre.google/sre-book/managing-incidents/) and [Postmortem Culture](https://sre.google/sre-book/postmortem-culture/), from Google's Site Reliability Engineering book.
- [More details about the October 4 outage](https://engineering.fb.com/2021/10/05/networking-traffic/outage-details/), Facebook's own account.
- [OpenIX maintenance policy](https://p.foundation/OpenIX/sla/maintenance): an exchange's notice period and off-peak windows.
- [GlobalNOC change management guidelines](https://docs.globalnoc.iu.edu/noc-doc/how-to/noc-tools/change-management/grnoc-global-change-management-guidelines-and-policy.html): how one NOC approves and schedules network maintenance.
- [NetBox documentation](https://netboxlabs.com/docs/netbox/): DCIM and IPAM in one tool.

## In short

- A change goes request, branch, validate, diff, pull request, review, window, apply, check, and the snapshot is committed every time.
- The reviewer reads the plan, above all its `-` lines, and asks who notices and how it is undone. A valid file is not always the change you meant.
- If `apply` plans more than the reviewed diff, someone changed the device by hand: stop and find out.
- In an incident, declare early, let one person run it, keep a live document, undo the last change first, and write a postmortem without blame.
- Circuit's files and `circuit addresses` have the config side of the plant; racks, power and cables beyond `link` live in a DCIM such as NetBox.
