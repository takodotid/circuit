# Frequently asked questions

## How do I rename a device?

Run `circuit rename <device> <new-name>`. It shows every change in every file, and writes them once you say yes. Then `circuit apply` the device, so it takes its new hostname. See [rename](/guide/cli#rename).

## How do I rename a site?

1. Change the site's name in `circuit.ts`, under `sites`.
2. Change `site` in each of its devices' files. The editor marks every one that still has the old name.
3. Rename the site's folder under `sites/` too, and fix the imports that point into it.

Nothing changes on any device: a site is only a name to Circuit.

## My network has more than one AS number. What do I do?

- **Different routers speak BGP as different AS numbers.** One network is enough. A router whose AS differs writes it in `routing.bgp.asn`.
- **The ASes are separate networks, with their own prefixes and communities.** Write one `circuit()` each in `circuit.ts`, each exported under its own name, such as `as64500` and `as64501`. Each device file calls its own network's `device()`. See [The network](/guide/project#the-network).
- **The networks are run by different teams.** Use one repository per network, so each team has its own history, secrets and access.

## My device shows something the file does not have. Will Circuit remove it?

Only if it is part of the device's configuration. Some things a device makes on its own, and they are not configuration: for example, RouterOS shows a dynamic firewall rule whenever a rule uses fasttrack. Circuit leaves those alone.

## Can I use Circuit on a device that is already in production?

Yes, carefully. The first plan removes everything your file doesn't describe yet, so:

1. Read what the device runs, with `circuit exec`, such as `/export` on RouterOS or `display current-configuration` on VRP.
2. Write the file to describe what should stay.
3. Run `circuit diff <device>`, and repeat until the plan holds only the changes you want.
4. Only then run `circuit apply <device>`, and answer yes.

## Do I need to learn TypeScript?

No more than these pages show. A project is plain data: names, numbers, lists and objects. The editor completes each field and says what is wrong as you type. The one place that needs a little TypeScript is a check of your own, in `lib/`.

## Do I need Node, npm or Bun?

No. The installer puts one program on your computer, `circuit`, with everything it needs inside. A **full** install, which the installer offers, adds Bun to pin Circuit's version inside the project.

## Can I run Circuit in CI?

Yes. Install it with the same command, set `DOTENV_PRIVATE_KEY` from your CI's secrets, and run `circuit validate`. `circuit apply <device> --confirm` sends without asking. Without a terminal, `apply` refuses to send unless `--confirm` is given.
