---
description: Who maintains Circuit, who has contributed to it, and the open source projects it is built with.
---

<script setup>
import circuit from "../package.json";
</script>

# Credits

Maintained by the {{ circuit.author.name }}, <a :href="`mailto:${circuit.author.email}`">{{ circuit.author.email }}</a>.

## Contributors

<ul>
    <li v-for="person in circuit.contributors" :key="person.name">
        <a :href="person.url">{{ person.name }}</a>
    </li>
</ul>

## With thanks to

[Bun](https://bun.sh), [TypeScript](https://www.typescriptlang.org), [ssh2](https://github.com/mscdex/ssh2), [Clack](https://github.com/bombshell-dev/clack), [VitePress](https://vitepress.dev), Paul Miller's [noble-ciphers](https://github.com/paulmillr/noble-ciphers) and [noble-hashes](https://github.com/paulmillr/noble-hashes) for decrypting secrets in Studio, and the [NLNOG Ring looking glass](https://github.com/NLNOG/lg.ring.nlnog.net) for its community format.
