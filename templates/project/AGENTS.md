# AGENTS.md

This repository describes a computer network with [Circuit](https://circuit.tako.id). Each network device, such as a router or a switch, has a TypeScript file that says how it should be configured. Circuit compares that file with what the device runs, and changes the device to match.

You are helping the owner of this network. Changes you make here can take a network down, so work carefully and let the owner decide.

## How Circuit works

1. `circuit.config.ts` lists every device and the checks to run.
2. Each device file calls `defineDevice`. What the file says is everything the device runs: a port, a user or a service that the file does not mention is removed or turned off when the device is applied.
3. A field is only written when it has a value. There is no `enabled: false`; leave a field out to turn it off.
4. Secrets are never written in a file. A file says `secret("NAME")`, and the value comes from `.env` or the environment. Never put a password, a key or a token in any other file, and never print one.
5. `.circuit/` is written by Circuit. Never edit it. `.circuit/state/` holds what each device ran when Circuit last read it.

What each field means is written as a comment on the field, in `node_modules/@takodotid/circuit/src/schema/`. Read it before using a field you have not used before. The documentation is at https://circuit.tako.id.

## Commands

| Command                                | What it does                                                         | Changes a device |
| -------------------------------------- | -------------------------------------------------------------------- | ---------------- |
| `npx circuit validate`                 | Checks every file and every rule in the checks                       | no               |
| `npx circuit diff [device]`            | Shows what would change, compared with the last snapshot             | no               |
| `npx circuit build <device>`           | Prints the full configuration the device should run                  | no               |
| `npx circuit snapshot [device]`        | Reads what each device runs now into `.circuit/state/`               | no, only reads   |
| `npx circuit apply <device>`           | Reads the device, then shows what would change on it                 | no               |
| `npx circuit apply <device> --confirm` | Sends the change to the device                                       | **yes**          |
| `npx circuit secrets`                  | Lists every secret the config uses, and whether each one can be read | no               |

## Making a change

1. Edit the device's file.
2. Run `npx circuit validate`. Fix every error.
3. Run `npx circuit diff <device>` and read the result.
4. Show the owner what will change and why, in plain words.
5. Run `npx circuit apply <device>` to see the plan against the live device.
6. **Stop.** Only run `apply <device> --confirm` after the owner says yes to that exact plan. Never confirm on your own, even if you were told to finish the task.
7. After the apply, commit the device file together with the updated `.circuit/state/`.

## Rules

- Never run `apply --confirm`, `refresh --confirm` or `peeringdb --confirm` without the owner's explicit approval for that run.
- If a plan removes something you did not expect, stop and ask. It usually means the file is missing something the device needs.
- Be careful with anything that carries your own access to the device: the management address, the management VLAN, the uplink, `management.allow`, and the login user. A mistake there locks everyone out.
- When you are not sure what a field does, or what the owner wants, ask instead of guessing.
