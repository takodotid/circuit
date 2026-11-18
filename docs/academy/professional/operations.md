---
title: Running it day to day
description: Take a change from request to device through review, handle an incident when one comes anyway, and keep racks, cables, and addresses written down.
---

# Running it day to day

Running a network day to day is three jobs:

- Changing it without breaking it.
- Fixing it fast when it breaks anyway.
- Knowing at all times what you have.

Most days are about the first job. Customers ask for ports, new networks join, and prefixes change. Each of those is a change to a device that carries other people's traffic.

With Circuit, a change is a change to a file. So it can go through the same steps as a change to software. It gets a branch, a plan anyone can read, and a second person who reviews it. Git keeps a record of who did what, and why.

## A change, from request to device

Every change follows the same steps, whatever its size:

1. **A request** that someone can point to later, saying who asked, for what, and by when. Usually it is a <Term means="A numbered record of a request or a problem, where everyone involved writes what they did, so the history stays in one place.">ticket</Term>.
2. **A branch** in git, so nothing reaches `main`, or a device, before review.
3. **The change** to the files, and `circuit validate`.
4. **The plan**, `circuit diff <device>`, against what the device runs now.
5. **A pull request** with the request linked and the plan pasted in.
6. **Review** by someone else.
7. **A window**, a time agreed in advance with whoever the change can affect.
8. **Apply**, `circuit apply <device>`. Read the plan, then say yes.
9. **Check** that it works.

<TryIt title="Walk one change through">

Netflix, a tenant of the [colocation example](/guide/examples#colocation-with-tenants), asks for a port for a third server.

<ChangeWalk />

</TryIt>

The diff and the plan from `apply` are the same comparison, made at different times. The diff in the pull request was read from the device days before the window, and `apply` reads it again. In the window, the plan from `apply` may be longer than the one in the pull request. Then the device changed since, most likely by hand. Answer no, and find out why. The file is the whole truth, so whatever someone added by hand is about to be removed.

Merge and then apply, or apply and then merge. Do both in the same window.

## Reviewing a change

A reviewer isn't there to check the spelling of a VLAN name. `circuit validate` does that, and <Term means="Continuous integration: a service that runs checks, such as circuit validate, on every pull request and shows whether they passed.">CI</Term> can run it on every pull request. A reviewer reads the plan and asks what a computer can't:

- **Does validate pass?** If not, there is nothing to review yet.
- **Does the plan do only what the request asks?** Look hardest at the lines that start with `-`, because something that exists now is going away.
- **Who notices, and when?** That decides the window, and who must be told.
- **How is it undone?** Usually by reverting the commit and applying again. If the answer is harder than that, the change needs a plan of its own.

<TryIt title="Review three pull requests">

<ChangeReview />

</TryIt>

The second pull request would have taken a paying customer's server off the network, because `10g-1` is the port of Netflix's server 1. Circuit stops when two tenant files write one port differently, so `validate` fails before anyone reads a plan. Not every mistake has a check written for it, though. When none does, the plan shows the mistake in plain words, on its `-` lines. A valid file isn't always the change you meant, and that is what review is for.

Studio helps the reviewer see the change as a network, not as text. Its [Compare](/studio/#review-a-change) shows each device's config then and now, the lines of the graph that are added or gone, and what `validate` finds now that it didn't before. Compare the pull request's branch with `main` before you approve it.

<Quiz
  question="CI passed and the plan for tor-01 shows an interface losing two VLANs that belong to a tenant who did not ask for anything. What do you do?"
  :choices="['Approve: CI passed, so the change is safe', 'Ask for changes, and ask the author which port the request meant', 'Approve, and tell the tenant afterwards']"
  :answer="1"
  :why="['CI runs the checks someone wrote. A plan can still have a change that no check was written for.', '', 'The tenant would find out first, when its server drops off the network.']"
  explain="A minus line on something that belongs to someone else is exactly what review is for. The file is valid, but it is not the change the request asked for."
/>

## The window and the way back

A change that can affect customers goes out in a <Term means="A time agreed in advance, usually at night or early morning when traffic is low, when planned work may interrupt service.">maintenance window</Term>. This is a time when traffic is low, announced in advance to whoever can notice. How far in advance is a matter of contract. One exchange, for example, announces its windows at least seven days ahead. It plans them for the quiet hours of the night or the early morning. An emergency, such as a fix for an outage in progress, skips the wait, but is still written down and announced as one.

In the window, apply one device at a time, starting where a mistake hurts least, and check each before the next. Circuit tests the plan first where the platform allows it, and makes sure it doesn't lock you out. [Make a change](/guide/apply#not-locking-you-out) says how, platform by platform.

That protects your access, not your customers. The way back for anything else is the way forward: revert the commit, and apply again.

<Quiz
  question="In the window, circuit apply tor-01 shows a plan of 40 lines. The plan in the pull request had 7. What do you do?"
  :choices="['Say yes: apply always reads the device, so its plan is the right one', 'Answer no, and find out what changed on the switch since the pull request', 'Run circuit diff again, and send what it shows']"
  :answer="1"
  :why="['It is the right plan for the switch as it is now, but 33 of its lines were never reviewed. Something changed on the device that nobody wrote down.', '', 'diff reads the same switch, so it now shows the same 40 lines. Those 33 lines are still unreviewed.']"
  explain="apply reads the device again, so the extra lines are changes made since the pull request, probably by hand. Saying yes would remove them unreviewed. Find out what they are first."
/>

## When it breaks

Sooner or later something breaks anyway. A fiber is cut, a device fails, or a change does something nobody expected. Large networks keep a <Term means="Network operations center: the people who watch the network and answer when it breaks.">NOC</Term>, a team that watches the network around the clock. Smaller ones have an engineer <Term means="Being the person who must answer alerts and calls outside working hours, for a set week or shift.">on call</Term>. Either way, an outage goes better with a few rules agreed before it starts. The Google book on running large systems gives these:

1. **Declare an incident early.** It is one if a second team must help, if customers can see it, or if an hour of focused work hasn't solved it. Closing a small one quickly costs little.
2. **One person runs it**, the incident commander, who decides and hands out the work. The people fixing it are the only ones changing anything.
3. **One person talks to everyone else**, customers included, with regular updates.
4. **Keep a live document** of what is known, what was tried, and who is doing what, with the most important part at the top.
5. **Afterwards, write a postmortem** without blame: the impact, what was done, the causes, and what stops it happening again.

If a change went out just before the trouble began, undo it first, and ask why afterwards. That is one more reason to keep every change small, written down, and easy to revert.

A real outage shows how much the rest matters. On October 4, 2021, during routine maintenance, a command meant to assess the capacity of Facebook's backbone disconnected every link of it. A tool that audits such commands should have stopped it, but had a bug. Facebook's DNS servers stop announcing their routes when they can't reach the data centers. So they withdrew them, and nobody outside could find any of the company's services.

The <Term means="A separate path to manage devices, such as a separate network or a console line, which keeps working when the main network does not.">out-of-band</Term> network was down too, so engineers had to travel to the data centers. They then brought services back in stages, because switching everything on at once could itself have overloaded power and systems. Every safeguard in this lesson appears in that story: a check before the change, a way in that doesn't depend on the network, and a careful way back.

## Keeping the plant written down

You can't run what you can't find. A provider keeps three records besides the configs:

- **<Term means="Records of the physical plant (racks, power, cables), and of which addresses are used where.">DCIM</Term>** holds the racks, what is mounted in which unit, the power feeds, and every cable from end to end.
- **<Term means="Records of the physical plant (racks, power, cables), and of which addresses are used where.">IPAM</Term>** holds every prefix and address, who has it, and what is free.
- **Capacity** says how full each port, link, and device is, from the monitoring in [Watching the network](/academy/professional/monitoring). Then an upgrade is ordered before a link fills, not after.

Circuit already has part of this. The files know every device, port, cable (`link`), VLAN, and address. Studio and `circuit addresses` list every address in use, and what is free.

What Circuit doesn't know is the physical plant: racks, power, serial numbers, and which building a device is in. Many networks keep that in [NetBox](https://netboxlabs.com/docs/netbox/), which describes itself as a source of truth that combines IPAM and DCIM. `circuit sync netbox` keeps NetBox in sync with your config, one way. Circuit writes, and NetBox shows. Each device's `site` and `role` place it there. See [NetBox](/integrations/netbox).

## Further reading

- [Managing Incidents](https://sre.google/sre-book/managing-incidents/) and [Postmortem Culture](https://sre.google/sre-book/postmortem-culture/), from the Google book on site reliability engineering.
- [More details about the October 4 outage](https://engineering.fb.com/2021/10/05/networking-traffic/outage-details/), the account by Facebook.
- [OpenIX maintenance policy](https://p.foundation/OpenIX/sla/maintenance): an exchange's notice period and off-peak windows.
- [GlobalNOC change management guidelines](https://docs.globalnoc.iu.edu/noc-doc/how-to/noc-tools/change-management/grnoc-global-change-management-guidelines-and-policy.html): how one NOC approves and schedules network maintenance.
- [NetBox documentation](https://netboxlabs.com/docs/netbox/): one tool for DCIM and IPAM.

## In short

- A change goes request, branch, validate, diff, pull request, review, window, apply, and check.
- The reviewer reads the plan, most of all its `-` lines, and asks who notices and how it is undone. A valid file isn't always the change you meant.
- If `apply` plans more than the reviewed diff, someone changed the device by hand. Stop and find out.
- In an incident, declare early, let one person run it, keep a live document, undo the last change first, and write a postmortem without blame.
- Circuit's files and Studio have the config side of the plant. Racks, power, and cables beyond `link` live in a DCIM such as NetBox.
