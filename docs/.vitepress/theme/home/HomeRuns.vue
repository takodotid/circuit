<script setup lang="ts">
// What it runs on: the proved models as a data plate, then the caution, then the networks that run Circuit.

import { withBase } from "vitepress";
import { HomeContent } from "./home-content";
</script>

<template>
    <section class="chapter runs" aria-labelledby="runs">
        <h2 id="runs" data-reveal><span>What it runs on</span></h2>
        <div class="body">
            <table class="proved" data-reveal>
                <caption>
                    Proved on production devices before release
                </caption>
                <thead>
                    <tr>
                        <th scope="col">Platform</th>
                        <th scope="col">Proved on</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="(entry, index) in HomeContent.PLATFORMS" :key="entry.platform" :style="{ '--i': index }">
                        <th scope="row">
                            <a :href="withBase(`/platforms/${entry.platform}`)">{{ entry.name }}</a>
                        </th>
                        <td>
                            <code v-for="model in entry.models" :key="model">{{ model }}</code>
                        </td>
                    </tr>
                </tbody>
            </table>

            <aside class="caution" data-reveal>
                <strong>Alpha</strong>
                <p>
                    Circuit is young. It runs a production network, but the way you write config can still change between releases, so
                    install an exact version and read the <a :href="HomeContent.RELEASES">release notes</a> before you upgrade.
                </p>
            </aside>

            <div class="users">
                <p>In production at</p>
                <a
                    v-for="user in HomeContent.USERS"
                    :key="user.name"
                    :href="user.link"
                    :aria-label="user.name"
                    class="logo"
                    :style="{
                        maskImage: `url(${withBase(user.logo)})`,
                        WebkitMaskImage: `url(${withBase(user.logo)})`,
                        aspectRatio: `${user.width} / ${user.height}`,
                    }"
                />
                <p class="yours">
                    Running Circuit in production? <a :href="`mailto:${HomeContent.EMAIL}`">Tell us</a>, and your logo goes here too.
                </p>
            </div>
        </div>
    </section>
</template>

<style scoped>
.proved {
    width: 100%;
    margin: calc(6 * var(--px)) 0 calc(28 * var(--px));
    border: 2px solid var(--circuit-ink);
    border-collapse: collapse;
    font-size: max(16px, calc(17 * var(--px)));
}

.proved caption {
    padding: calc(12 * var(--px)) calc(18 * var(--px));
    background: var(--circuit-ink);
    color: var(--circuit-paper);
    font-size: max(11px, calc(13 * var(--px)));
    font-weight: 700;
    font-stretch: 118%;
    letter-spacing: 0.1em;
    text-align: left;
    text-transform: uppercase;
}

.proved thead {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
}

.proved th,
.proved td {
    padding: calc(16 * var(--px)) calc(18 * var(--px));
    border-top: 1px solid var(--circuit-line);
    text-align: left;
    vertical-align: top;
}

.proved tbody th {
    width: 48%;
}

.proved td code {
    display: inline-block;
    margin: 0 6px 4px 0;
}

.caution {
    margin: 0 0 calc(40 * var(--px));
    padding: calc(20 * var(--px)) calc(24 * var(--px)) calc(6 * var(--px));
    border: 2px solid var(--circuit-red);
}

.caution strong {
    display: inline-block;
    margin-bottom: calc(10 * var(--px));
    padding: 2px 8px;
    background: var(--circuit-red);
    color: #ffffff;
    font-size: max(11px, calc(12 * var(--px)));
    font-weight: 700;
    font-stretch: 120%;
    letter-spacing: 0.1em;
    text-transform: uppercase;
}

.users {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px calc(28 * var(--px));
    padding-top: calc(24 * var(--px));
    border-top: 1px solid var(--circuit-line);
}

.users p {
    margin: 0 !important;
}

.users .logo {
    display: block;
    height: max(26px, calc(32 * var(--px)));
    background-color: var(--circuit-ink);
    -webkit-mask-size: contain;
    mask-size: contain;
    -webkit-mask-repeat: no-repeat;
    mask-repeat: no-repeat;
}

.users .yours {
    flex-basis: 100%;
    color: var(--circuit-soft);
    font-size: max(15px, calc(16 * var(--px))) !important;
}

@media (prefers-reduced-motion: no-preference) {
    .proved.shown tbody tr {
        animation: home-rise 0.65s var(--ease) backwards;
        animation-delay: calc(var(--i) * 0.12s);
    }

    .caution.shown {
        animation: home-rise 0.7s var(--ease) 0.15s backwards;
    }
}

@media (max-width: 760px) {
    .proved th,
    .proved td {
        display: block;
        width: auto !important;
        padding: 12px 14px;
    }

    .proved td {
        border-top: 0;
        padding-top: 0;
    }
}
</style>
