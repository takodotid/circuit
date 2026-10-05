# Patterns

A pattern is a ready-made layout for one kind of network, with example devices you change to your own. `npx @takodotid/circuit new` asks which one is closest to yours and copies it. The files on each page are exactly the files you get.

| Pattern                                         | For                                                                      | Uses BGP |
| ----------------------------------------------- | ------------------------------------------------------------------------ | -------- |
| [A single site](/patterns/single-site)          | A home, an office or an internal network: a router and a switch          | no       |
| [An edge router](/patterns/edge-router)         | Your own AS number, with an IP transit and an internet exchange          | yes      |
| [Colocation with tenants](/patterns/colocation) | A provider whose customers each get their own VLANs, addresses and ports | yes      |

Each pattern is a starting point. Take what fits, and grow from there: the colocation pattern is the edge router with a switch and tenants added.

Every project also gets an `AGENTS.md` for [AI agents](/integrations/ai-agents), a `README.md`, a `.gitignore` and a `.env` for its [secrets](/guide/secrets).
