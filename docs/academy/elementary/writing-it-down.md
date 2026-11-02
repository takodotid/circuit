---
title: Writing a network down
description: Write a router's whole configuration in one Circuit file, change it, and read the plan Circuit makes before anything is sent.
---

# Writing a network down

A device's configuration is everything it is set to do: its name, who may log in, what each port is for, its addresses and its routes. With Circuit, you write each device's configuration in one file, and Circuit makes the device match it.

Circuit checks the file, shows you a plan of exactly what would change on the device, and sends the change only once you say yes. The files are kept in git, so every change is recorded with who made it, when, and why.

## The old way: log in and type

Without a tool like Circuit, you change a router by logging in to it over SSH and typing commands. Each command takes effect as soon as you press Enter. This works, and every network engineer does it, but it has problems that grow with the network:

- **No record.** The device keeps the result, not the story. A year later, nobody knows who turned on port 5, or why.
- **Drift.** Someone turns something on to test it and forgets to turn it off. Two switches that should be set up the same slowly stop being the same. This slow change away from the plan is called <Term means="When what a device runs slowly stops matching what it was meant to run, through small changes nobody wrote down.">drift</Term>.
- **No review.** Nobody sees a change before it is made, so a typo is found when the network breaks.
- **No way back.** To rebuild a broken device, someone has to remember everything it was set to do.

## One file per device

In Circuit, each device is one <Term means="A programming language that is JavaScript with types. Circuit uses it so your editor can check each file as you type.">TypeScript</Term> file. Here is a whole router:

```ts
// sites/office/router.ts
import { as64500 } from "../../circuit";

export default as64500.device({
    name: "router",
    site: "office",
    platform: "routeros",
    model: "CCR2216-1G-12XS-2XQ",
    connection: { host: "192.168.10.1", user: "operator" },
    system: {
        users: {
            operator: { role: "admin", password: secret("ROUTER_PASSWORD") },
            intern: { role: "read-only", password: secret("INTERN_PASSWORD") },
        },
    },
    management: { allow: ["192.168.10.0/24"], ssh: {} },

    interfaces: {
        ethernet: {
            "1g-1": { description: "Internet provider", addresses: ["203.0.113.2/30"] },
            "25g-1": { description: "Office", addresses: ["192.168.10.1/24"] },
        },
    },
    routing: { static_routes: [{ prefix: "0.0.0.0/0", next_hop: "203.0.113.1" }] },
});
```

You do not need to know TypeScript to read it. It is names and values inside braces. `as64500.device(...)` around them says "this is a device of the network `as64500`", which `circuit.ts` writes, and the `import` line at the top brings that network in. Here is what each part says:

| Part                | What it says                                                                                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `name`              | The router's name, which Circuit sets as its hostname.                                                                                                                         |
| `site`              | Where the router is: one of the sites `circuit.ts` lists.                                                                                                                      |
| `platform`, `model` | Which operating system the router runs and which hardware it is. Together they decide the commands Circuit sends and which ports exist.                                        |
| `connection`        | How Circuit reaches the router: its address, and which user it logs in as.                                                                                                     |
| `system.users`      | Who may log in, and what they may do. `secret("ROUTER_PASSWORD")` means the password is not in the file: Circuit reads it from `.env`, encrypted, only when it sends a change. |
| `management`        | SSH is on, and only addresses in `192.168.10.0/24` may use it.                                                                                                                 |
| `interfaces`        | What each port is for, and its IP address. Ports are named by speed and place: `25g-1` is the first 25G port. Circuit turns that into the router's own name for it.            |
| `routing`           | The default route: anything not on the router's own networks goes to the provider at `203.0.113.1`.                                                                            |

Your editor knows every field. Hover one to see what it means, and a name that does not exist, such as a port this model does not have, is underlined in red as you type.

## The file is the whole truth

The most important idea in Circuit is this: **a device runs exactly what its file says, and nothing else.** Circuit compares what the device runs with the file, and plans to remove anything the file does not describe:

- A user the file does not list is removed.
- A port the file does not list is shut down.
- A service the file does not turn on, such as the web interface, is turned off.

So you only ever write what is on. To turn something off, you leave it out. There is no `enabled: false` in Circuit. This is what makes the file worth trusting: if something is not in the file, it is not on the device.

Try it. Each button changes the file, and the second box is the plan Circuit makes from it: the commands it would send, in the router's own language. Lines marked `~` change something, `+` add something and `-` remove something.

<TryIt title="Change the file and read the plan">

<PlanEditor />

</TryIt>

Look at the last button. Nobody touched the file, yet the plan changed: someone turned on a port by hand. The file does not list that port, so Circuit turns it off again. Drift is undone the next time the file is applied, and you see it in the plan before it happens.

::: tip The plans are real
Every plan in this widget is what `circuit diff` printed for that exact file. The `/interface ethernet` and `/user` lines are the parts of the router each command goes to. A line starting with `-` takes a line of the router's configuration away, so `- add group=read name=intern` takes away the line that added the intern's login.
:::

<Quiz
  question="Someone adds a user called test to the router by hand. The file does not list it. What happens at the next apply?"
  :choices="['Nothing: Circuit leaves alone what it did not create', 'The user test is removed, and the plan shows it first', 'Circuit adds the user test to the file']"
  :answer="1"
  :why="['Circuit does not keep anything just because it is already there. The file is the whole truth.', '', 'Circuit does not copy what a device runs back into your files. The files say what the device should run, never the other way round.']"
  explain="A user the file does not list is removed. The plan shows the removal as a line starting with a minus sign, so you see it before anything is sent."
/>

## Check, plan, send

A change to the network always takes the same steps. You run each command from your project folder:

1. Change the device's file.
2. Run `circuit validate`. It checks every file: names, addresses, and whether the device can do what you wrote. It never touches a device.
3. Run `circuit diff router`. It logs in, reads what the router runs right now, and shows the plan against that. Nothing is sent.
4. Run `circuit apply router`. It shows the same plan, and asks: **Send these changes to router?** The answer is No unless you choose Yes, so a stray Enter sends nothing.
5. Say yes. Circuit sends the plan, then logs in again in a new session, and keeps the change for good only if that works, so a change that locks you out is not kept. [How a change is applied](/guide/apply) explains this.
6. Commit the file with git.

Validate is the step that catches mistakes, before any device sees them. Make some, and see what it says:

<TryIt title="Catch a mistake before it is sent">

<ValidateCatch />

</TryIt>

<Quiz
  question="Which of these commands changes something on the router?"
  :choices="['circuit validate', 'circuit diff router', 'circuit apply router, answering No', 'circuit apply router, answering Yes']"
  :answer="3"
  :why="['Validate only reads your files. It never logs in to a device.', 'Diff reads the router and shows the plan, then stops. Nothing is sent.', 'Apply sends nothing until you say yes.', '']"
  explain="Only apply, once you say yes, sends the plan. Every other command reads, checks or shows, so you can run them as often as you like."
/>

## Git keeps the history

<Term means="A tool that keeps every version of a set of files, with who changed each one, when, and a message saying why.">Git</Term> is the answer to "who changed what, and why". Each time you commit, git keeps the new version of the file with your name, the time and a message:

```sh
git add sites/office/router.ts
git commit -m "Describe the office port"
```

In VS Code, the Source Control panel does the same with buttons. The history of the folder is the history of the network: every change, with who made it and why. A teammate can review a change in a <Term means="A proposed change to the files, which others read and comment on before it is accepted.">pull request</Term> before it is applied. To undo a change, put the old version of the file back with git, and apply it.

## In short

- A device's configuration is everything it is set to do. Circuit keeps it in one TypeScript file per device, written with `<network>.device()`.
- The file is the whole truth: a user, a port or a service the file leaves out is removed or turned off.
- `circuit validate` checks the files, `circuit diff` shows the plan against the device, and `circuit apply` sends it once you say yes.
- Git keeps every version, so you always know who changed what, when and why.
