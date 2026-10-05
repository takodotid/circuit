# AI agents

Your network is a set of TypeScript files, so an AI coding agent, such as Claude Code, Codex or Cursor, can work on it the way it works on any code: read the files, make a change, and check it with Circuit's commands.

Circuit is built to make that safe. The agent can see exactly what a change does before it reaches a device, and nothing is sent without `--confirm`.

## What the agent needs to know

`circuit new` puts an `AGENTS.md` in every project. Agents read it before they start, and it tells them how Circuit works, which commands are safe, and what they must never do without asking you. `CLAUDE.md` points Claude Code at the same file.

If your project was not made with `circuit new`, copy this into `AGENTS.md`:

<<< @/../templates/project/AGENTS.md{md}

Add what is particular to your network below it: your naming rules, which ports carry your own access, who to ask about what.

## Asking for a change

Describe what you want, the way you would tell a colleague. Say whether the agent may apply it. For example:

> Add a VLAN 40 for cameras. Put ports 10g-5 to 10g-8 on the switch in it, and give it a gateway and DHCP on the router, 192.168.40.0/24. Cameras must not reach the home network. Show me the diff; do not apply.

> Explain the plan for edge-01. Is anything in it risky?

> Add a tenant called globex, number 2, with 198.51.100.16/29, on port 10g-3 of tor-01. Validate and diff, then stop.

A good agent will edit the files, run `npx circuit validate` and `npx circuit diff`, and show you the result in plain words.

## Keep the last step yours

Applying a change is the one step that touches your network. Keep it for yourself:

1. Let the agent run `validate`, `diff`, `build`, `snapshot` and `apply` without `--confirm`. None of them change a device.
2. Read the plan it shows you.
3. Run `apply <device> --confirm` yourself, or tell the agent to run exactly that, for that plan only.

Most agents let you require approval for a command. In Claude Code, for example, add this to `.claude/settings.json` in the project, so every `apply` asks you first, and `.env` is never read:

```json
{
    "permissions": {
        "ask": ["Bash(npx circuit apply:*)"],
        "deny": ["Read(./.env)"]
    }
}
```

## Keep secrets away from the agent

The agent never needs a password to edit files or to plan. Only `snapshot` and `apply` log in to a device.

If your secrets are in [1Password](/integrations/1password), `.env` only holds references, so opening it shows the agent no password. Reading a value goes through 1Password, which asks you to approve access first. Otherwise, deny the agent access to `.env` as above.
