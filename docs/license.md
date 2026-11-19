---
description: Circuit's license in short, who maintains Circuit, and the open source projects it is built with.
---

<script setup>
import circuit from "../package.json";
</script>

# License and credits

Circuit is released under the [Business Source License 1.1](https://github.com/takodotid/circuit/blob/main/LICENSE).

| Who                            | What they may do                                   |
| ------------------------------ | -------------------------------------------------- |
| Anyone                         | Copy, change, share, and use it outside production |
| A small organization or person | Use it in production, for free                     |
| Anyone else                    | Use it in production with a commercial license     |

"Small" means that you and your affiliates had at most USD 100,000 in revenue, and at most USD 100,000 in funds raised, in the last 12 months.

Four years after a version is published, that version moves to the Apache License 2.0.

Every copy, changed or not, must include the `LICENSE` file.

For a commercial license, write to [legal@tako.id](mailto:legal@tako.id).

This page is a summary. The `LICENSE` file is what counts.

## Credits

Circuit is maintained by the {{ circuit.author.name }}, <a :href="`mailto:${circuit.author.email}`">{{ circuit.author.email }}</a>.

### Contributors

<ul>
    <li v-for="person in circuit.contributors" :key="person.name">
        <a :href="person.url">{{ person.name }}</a>
    </li>
</ul>

### With thanks to

- [Bun](https://bun.sh) and [TypeScript](https://www.typescriptlang.org), which Circuit is written in and runs on.
- [ssh2](https://github.com/mscdex/ssh2), which talks to the devices.
- [Commander](https://github.com/tj/commander.js) and [Clack](https://github.com/bombshell-dev/clack), for the `circuit` command and its prompts.
- [Prettier](https://prettier.io), which `circuit fmt` carries inside.
- [Vue](https://vuejs.org), [Vite](https://vite.dev), and [Cytoscape.js](https://js.cytoscape.org), which Circuit Studio is built with.
- Paul Miller's [noble-ciphers](https://github.com/paulmillr/noble-ciphers) and [noble-hashes](https://github.com/paulmillr/noble-hashes), for decrypting secrets in Studio.
- [VitePress](https://vitepress.dev), for this website.
- The [NLNOG Ring looking glass](https://github.com/NLNOG/lg.ring.nlnog.net), for its community format.

### Networks in the samples

The companies and AS numbers named as customers in the docs and examples are real networks, chosen as samples. None of them is a customer of Circuit's authors, and nothing here describes their real setup. A company that would rather not appear can [open an issue](https://github.com/takodotid/circuit/issues), and it will be replaced.

<!-- vale Vale.Terms = NO -->

| Network                       | AS       | Country     |
| ----------------------------- | -------- | ----------- |
| Tsukaeru.net                  | AS63997  | Japan       |
| Kapsi Internet                | AS57692  | Finland     |
| PLINQ BV                      | AS35224  | Netherlands |
| Nedap N.V.                    | AS213050 | Netherlands |
| MediaServe International B.V. | AS41529  | Netherlands |
| Strathmore University         | AS328225 | Kenya       |
| INFIX TELECOM LTDA            | AS264009 | Brazil      |

<!-- vale Vale.Terms = YES -->
