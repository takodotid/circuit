<script setup lang="ts">
import { ref } from "vue";
import { withBase } from "vitepress";
import circuit from "../../../package.json";
import { catalog } from "../../../src/adapters/devices/catalog";

const install = "bunx @takodotid/circuit new";
const copied = ref(false);

async function copy() {
    await navigator.clipboard.writeText(install);
    copied.value = true;
    setTimeout(() => (copied.value = false), 1500);
}

const releases = `${circuit.repository.url.replace(/^git\+/, "").replace(/\.git$/, "")}/releases`;

const platforms = [
    { name: "MikroTik RouterOS 7", platform: "routeros" },
    { name: "Huawei VRP", platform: "vrp" },
    { name: "Raisecom ROS", platform: "raisecom-ros" },
].map((entry) => ({ ...entry, models: Object.keys(catalog[entry.platform as keyof typeof catalog]).join(", ") }));
</script>

<template>
    <article class="home">
        <header class="opening">
            <h1>Your network, written down.</h1>
            <p class="lead">
                Circuit keeps the configuration of every router and switch in plain files, in git. Before anything reaches a device, it
                shows you exactly what would change. Then it makes the device match the file, and nothing else.
            </p>

            <p class="start">
                Start a project with
                <button type="button" class="command" @click="copy" :title="copied ? 'Copied' : 'Copy'">{{ install }}</button>
                <span class="copied" aria-live="polite">{{ copied ? " copied" : "" }}</span>
                or read <a :href="withBase('/guide/introduction')">what Circuit is</a> first.
            </p>
        </header>

        <figure class="figure">
            <svg viewBox="0 0 760 290" role="img" aria-labelledby="figure-caption">
                <g class="files">
                    <g
                        v-for="(file, index) in ['edge-01.ts', 'core-01.ts', 'tor-01.ts']"
                        :key="file"
                        :transform="`translate(${70 + index * 240}, 8)`"
                    >
                        <path d="M0 0 H62 L80 18 V92 H0 Z" />
                        <path d="M62 0 V18 H80" />
                        <line x1="14" y1="34" x2="64" y2="34" />
                        <line x1="14" y1="46" x2="56" y2="46" />
                        <line x1="14" y1="58" x2="66" y2="58" />
                        <line x1="14" y1="70" x2="44" y2="70" />
                        <text x="40" y="122" text-anchor="middle">{{ file }}</text>
                    </g>
                </g>

                <g class="ties">
                    <line v-for="index in [0, 1, 2]" :key="index" :x1="110 + index * 240" y1="142" :x2="110 + index * 240" y2="196" />
                </g>

                <g class="devices">
                    <g
                        v-for="(device, index) in ['router', 'core switch', 'top-of-rack switch']"
                        :key="device"
                        :transform="`translate(${40 + index * 240}, 196)`"
                    >
                        <rect width="140" height="40" rx="3" />
                        <rect v-for="port in 6" :key="port" class="port" :x="14 + (port - 1) * 19" y="15" width="10" height="10" />
                        <text x="70" y="66" text-anchor="middle">{{ device }}</text>
                    </g>
                </g>

                <g class="cables">
                    <path d="M180 216 H280" />
                    <path d="M420 216 H520" />
                </g>
            </svg>
            <figcaption id="figure-caption">One file for each device. What the file says is what the device runs.</figcaption>
        </figure>

        <section class="chapter">
            <h2>Why</h2>
            <div class="text">
                <p>
                    A network configured by hand drifts. Someone adds a VLAN during an outage, someone else tests a firewall rule and
                    forgets it, and a year later nobody knows why a port is on. The device is the only record, and it does not say who
                    changed what, or why.
                </p>
                <p>
                    With Circuit the record is the file. A port the file does not mention is shut down. A user it does not list is removed.
                    A service it does not turn on is off. Git keeps every change, with its author and its reason.
                </p>
            </div>
        </section>

        <section class="chapter">
            <h2>How</h2>
            <div class="text">
                <ol class="steps">
                    <li>
                        <strong>Change the file.</strong> VLANs, ports, addresses, routing, firewall: the same words for every vendor. Your
                        editor checks every name as you type.
                    </li>
                    <li>
                        <strong>Check it.</strong> Circuit catches what a device cannot do, and any rule of your own that the change breaks.
                    </li>
                    <li>
                        <strong>Read the plan.</strong> Every command that would be sent, in the vendor's own language, before anything is
                        sent.
                    </li>
                    <li>
                        <strong>Confirm.</strong> Circuit applies the change the safest way the device allows, and keeps it only once it can
                        still log in afterwards.
                    </li>
                </ol>
                <p><a class="onward" :href="withBase('/guide/getting-started')">Get started</a></p>
            </div>
        </section>

        <section class="chapter">
            <h2>Where to begin</h2>
            <div class="text">
                <p>Pick the layout closest to your network. Each one is a working project you change to your own.</p>
                <dl class="patterns">
                    <div>
                        <dt><a :href="withBase('/patterns/single-site')">A single site</a></dt>
                        <dd>A home, an office or an internal network. A router and a switch, no BGP.</dd>
                    </div>
                    <div>
                        <dt><a :href="withBase('/patterns/edge-router')">An edge router</a></dt>
                        <dd>Your own AS number, with an IP transit and an internet exchange.</dd>
                    </div>
                    <div>
                        <dt><a :href="withBase('/patterns/colocation')">Colocation with tenants</a></dt>
                        <dd>Customers who each get their own VLANs, addresses and ports.</dd>
                    </div>
                </dl>
            </div>
        </section>

        <section class="chapter">
            <h2>What it runs on</h2>
            <div class="text">
                <ul class="platforms">
                    <li v-for="entry in platforms" :key="entry.platform">
                        <a :href="withBase(`/platforms/${entry.platform}`)">{{ entry.name }}</a
                        >, proved on the {{ entry.models }}
                    </li>
                </ul>
                <p>Each was proved on production devices before it was released.</p>
                <p class="aside">
                    Circuit is young. It runs a production network, but the way you write config can still change between releases, so
                    install an exact version and read the <a :href="releases">release notes</a> before you upgrade.
                </p>
            </div>
        </section>
    </article>
</template>

<style scoped>
.home {
    --serif: var(--circuit-serif);
    --ink: var(--vp-c-text-1);
    --soft: var(--vp-c-text-2);
    --rule: var(--vp-c-divider);
    --mark: var(--vp-c-brand-1);

    max-width: 1040px;
    margin: 0 auto;
    padding: 56px 16px 120px;
}

@media (min-width: 768px) {
    .home {
        padding: 96px 32px 160px;
    }
}

a {
    color: var(--ink);
    text-decoration: underline;
    text-decoration-color: var(--rule);
    text-decoration-thickness: 1px;
    text-underline-offset: 3px;
    transition: text-decoration-color 0.2s;
}

a:hover {
    text-decoration-color: var(--mark);
}

/* Opening */

.opening {
    max-width: 820px;
}

h1 {
    margin: 0;
    font-family: var(--serif);
    font-size: clamp(48px, 9vw, 104px);
    font-weight: 400;
    line-height: 0.98;
    letter-spacing: -0.02em;
    color: var(--ink);
}

.lead {
    margin: 32px 0 0;
    max-width: 600px;
    font-size: 20px;
    line-height: 1.6;
    color: var(--soft);
}

.start {
    margin: 28px 0 0;
    max-width: 640px;
    font-size: 16px;
    line-height: 2;
    color: var(--soft);
}

.command {
    display: inline;
    padding: 2px 10px;
    border: 1px solid var(--rule);
    border-radius: 6px;
    font: inherit;
    font-weight: 600;
    color: var(--ink);
    cursor: copy;
    transition: border-color 0.2s;
}

.command:hover {
    border-color: var(--mark);
}

.copied {
    font-size: 14px;
    color: var(--mark);
}

/* The figure */

.figure {
    margin: 80px 0 0;
    padding: 0;
}

.figure svg {
    display: block;
    width: 100%;
    max-width: 760px;
    height: auto;
    overflow: visible;
}

.figure path,
.figure line,
.figure rect {
    fill: none;
    stroke: var(--ink);
    stroke-width: 1.25;
}

.figure .files line {
    stroke: var(--soft);
}

.figure .ties line {
    stroke: var(--mark);
    stroke-dasharray: 3 4;
}

.figure .port {
    stroke: var(--soft);
}

.figure .cables path {
    stroke-width: 2;
}

.figure text {
    fill: var(--soft);
    font-family: var(--vp-font-family-base);
    font-size: 14px;
}

/* The figure shrinks with the screen, so its labels grow to stay readable. */
@media (max-width: 640px) {
    .figure text {
        font-size: 24px;
    }
}

figcaption {
    margin-top: 16px;
    max-width: 760px;
    font-family: var(--serif);
    font-style: italic;
    font-size: 18px;
    color: var(--soft);
}

/* Chapters: a heading in the margin, the text beside it. */

.chapter {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 12px;
    margin-top: 72px;
    padding-top: 28px;
    border-top: 1px solid var(--rule);
}

@media (min-width: 768px) {
    .chapter {
        grid-template-columns: 240px minmax(0, 620px);
        gap: 48px;
        margin-top: 96px;
    }
}

h2 {
    margin: 0;
    padding: 0;
    border: none;
    font-family: var(--serif);
    font-size: 30px;
    font-weight: 400;
    line-height: 1.2;
    letter-spacing: -0.01em;
    color: var(--ink);
}

.text p,
.platforms li {
    margin: 0 0 18px;
    font-size: 17px;
    line-height: 1.75;
    color: var(--soft);
}

.text strong {
    color: var(--ink);
    font-weight: 600;
}

.steps {
    margin: 0 0 24px;
    padding: 0;
    list-style: none;
    counter-reset: step;
}

.steps li {
    position: relative;
    margin: 0 0 16px;
    padding-left: 40px;
    font-size: 17px;
    line-height: 1.75;
    color: var(--soft);
    counter-increment: step;
}

.steps li::before {
    content: counter(step);
    position: absolute;
    left: 0;
    top: -2px;
    font-family: var(--serif);
    font-size: 26px;
    font-style: italic;
    line-height: 1.4;
    color: var(--mark);
}

.onward {
    font-weight: 600;
}

.onward::after {
    content: " \2192";
}

.patterns {
    margin: 8px 0 0;
}

.patterns div {
    padding: 16px 0;
    border-bottom: 1px solid var(--rule);
}

.patterns div:first-child {
    border-top: 1px solid var(--rule);
}

.patterns dt {
    font-family: var(--serif);
    font-size: 22px;
    line-height: 1.3;
}

.patterns dt a {
    text-decoration: none;
}

.patterns dt a:hover {
    color: var(--mark);
}

.patterns dd {
    margin: 4px 0 0;
    font-size: 16px;
    line-height: 1.6;
    color: var(--soft);
}

.platforms {
    margin: 0 0 8px;
    padding: 0;
    list-style: none;
}

.platforms li {
    margin: 0 0 6px;
}

.aside {
    margin-top: 32px !important;
    padding-left: 16px;
    border-left: 2px solid var(--mark);
    font-size: 15px !important;
}
</style>
