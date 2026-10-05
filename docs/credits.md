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

[Bun](https://bun.sh), [TypeScript](https://www.typescriptlang.org), [ssh2](https://github.com/mscdex/ssh2), [VitePress](https://vitepress.dev), and the [NLNOG Ring looking glass](https://github.com/NLNOG/lg.ring.nlnog.net) for its community format.
