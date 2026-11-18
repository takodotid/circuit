---
description: What Circuit's own words mean, such as project, part, and plan, with a link to the Academy glossary for networking words.
---

# Glossary

## Circuit

| Word             | Meaning                                                                                                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Project          | The folder that describes your network: `circuit.ts`, and one file per device under `sites/`. See [Your first project](/guide/project).                                              |
| Network          | What `circuit()` in `circuit.ts` describes. A project can have more than one.                                                                                                        |
| Site             | A place with devices, such as an office or a colocation rack.                                                                                                                        |
| Platform         | The operating system of a device, such as `routeros` for MikroTik. See [Platforms](/reference/platforms).                                                                            |
| Model            | The hardware of a device, such as `CCR2216-1G-12XS-2XQ`. It decides the port names. In Circuit's code, [the model](/reference/model) is what Circuit holds after it reads a project. |
| Adapter          | The code in Circuit that reads, plans, and writes the config of one platform.                                                                                                        |
| Plan             | The commands that would make a device match its file. `circuit diff` shows it, and `circuit apply` sends it.                                                                         |
| Rule             | One `{ if, then }` step, such as in a firewall chain or a route policy. See [Rules](/guide/rules).                                                                                   |
| Part             | What one file adds to a device written in another, such as a tenant's VLAN. See [Parts and merge](/guide/parts).                                                                     |
| Check            | A test of the whole network that `circuit validate` runs. See [Checks and errors](/guide/checks).                                                                                    |
| Secret           | A value kept encrypted, such as a password: `secret("NAME")`. See [Secrets](/guide/secrets).                                                                                         |
| Community scheme | Your BGP communities, written once in `circuit.ts`. See [BGP communities](/guide/communities).                                                                                       |
| Studio           | Your project in the browser, opened with `circuit studio`. See [Studio](/studio/).                                                                                                   |

`merge`, `literal`, `presets`, and the other globals are in [Globals](/guide/project#globals).

## Networking

Networking words are in the [Academy glossary](/academy/glossary).
