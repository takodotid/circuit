<script setup lang="ts">
import { ref } from "vue";
import { withBase } from "vitepress";
import circuit from "../../../package.json";
import { catalog } from "../../../src/adapters/devices/catalog";

const install = "npx @takodotid/circuit new";
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

// Traces behind the opening, like the copper on a circuit board. Each ends in a pad; the ones marked `live` carry a signal.
const traces = [
    { d: "M640 64 H452 L412 104 H292", live: false },
    { d: "M640 132 H500 L460 172 V236 L420 276 H318", live: true },
    { d: "M640 204 H548 L516 236 H430", live: false },
    { d: "M640 316 H468 L428 356 H246", live: true },
    { d: "M640 392 H528 L496 424 H370", live: false },
    { d: "M600 0 V36 L560 76 H476", live: false },
    { d: "M640 264 H596 L572 288 V364 L548 388 H488", live: false },
    { d: "M548 470 V440 L512 404 H452", live: false },
];

/** The last point of a path written with M, H, V and L, where its pad sits. */
function endOf(d: string): [number, number] {
    let x = 0;
    let y = 0;

    for (const [, command, values] of d.matchAll(/([MHVL])([^MHVL]*)/g)) {
        const numbers = values!
            .trim()
            .split(/[\s,]+/)
            .map(Number);
        if (command === "H") x = numbers[0]!;
        else if (command === "V") y = numbers[0]!;
        else [x, y] = [numbers[0]!, numbers[1]!];
    }

    return [x, y];
}

// Networks that run on Circuit in production. Each logo is drawn in the page's own ink, so one image works in light and dark.
const users = [{ name: "Tako", logo: "/users/tako.png", link: "https://tako.id", width: 1292, height: 602 }];

// Ports lit on each device in the figure, as if a cable were in them.
const lit = [
    [1, 2, 4],
    [1, 3, 5, 6],
    [1, 2, 3, 6],
];
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
                or with pnpm or Bun, or read <a :href="withBase('/guide/introduction')">what Circuit is</a> first.
            </p>

            <svg class="traces" viewBox="0 0 640 470" aria-hidden="true">
                <path v-for="trace in traces" :key="trace.d" :d="trace.d" :class="{ live: trace.live }" />
                <path v-for="trace in traces.filter((each) => each.live)" :key="`signal-${trace.d}`" :d="trace.d" class="signal" />
                <circle
                    v-for="trace in traces"
                    :key="`pad-${trace.d}`"
                    :cx="endOf(trace.d)[0]"
                    :cy="endOf(trace.d)[1]"
                    r="5"
                    :class="{ live: trace.live }"
                />
            </svg>
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
                        <rect
                            v-for="port in 6"
                            :key="port"
                            class="port"
                            :class="{ lit: lit[index]!.includes(port) }"
                            :x="14 + (port - 1) * 19"
                            y="15"
                            width="10"
                            height="10"
                        />
                        <text x="70" y="66" text-anchor="middle">{{ device }}</text>
                    </g>
                </g>

                <g class="cables">
                    <path d="M180 216 H280" />
                    <path d="M420 216 H520" />
                </g>

                <g class="notes">
                    <text x="646" y="56">what you write</text>
                    <text x="670" y="221">what it runs</text>
                </g>
            </svg>
            <figcaption id="figure-caption">One file for each device. What the file says is what the device runs.</figcaption>
        </figure>

        <aside class="users">
            <p>In production at</p>
            <a
                v-for="user in users"
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
                Running Circuit in production? <a :href="`mailto:${circuit.author.email}`">Tell us</a>, and your logo goes here too.
            </p>
        </aside>

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

    position: relative;
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

.opening > :not(.traces) {
    position: relative;
    z-index: 1;
}

/* The traces sit to the right of the opening, fading out toward the text. On a narrow screen they would sit under it. */
.traces {
    position: absolute;
    top: 48px;
    right: -64px;
    width: 600px;
    height: auto;
    pointer-events: none;
    -webkit-mask-image: linear-gradient(to right, transparent, black 40%);
    mask-image: linear-gradient(to right, transparent, black 40%);
}

@media (max-width: 1099px) {
    .traces {
        display: none;
    }
}

.traces path {
    fill: none;
    stroke: var(--rule);
    stroke-width: 2;
    stroke-linejoin: round;
}

.traces path.live {
    stroke: var(--mark);
    opacity: 0.45;
}

.traces path.signal {
    stroke: var(--mark);
    stroke-width: 2.5;
    stroke-dasharray: 14 520;
    animation: signal 4.5s linear infinite;
}

.traces path.signal:nth-of-type(odd) {
    animation-delay: -2s;
}

@keyframes signal {
    from {
        stroke-dashoffset: 534;
    }
    to {
        stroke-dashoffset: 0;
    }
}

@media (prefers-reduced-motion: reduce) {
    .traces path.signal {
        animation: none;
        stroke-dasharray: none;
        opacity: 0.45;
    }
}

.traces circle {
    fill: var(--vp-c-bg);
    stroke: var(--rule);
    stroke-width: 2;
}

.traces circle.live {
    stroke: var(--mark);
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

.figure .port.lit {
    fill: var(--mark);
    stroke: var(--mark);
}

.figure .notes text {
    fill: var(--mark);
    font-family: var(--serif);
    font-style: italic;
    font-size: 17px;
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

/* The networks that run Circuit, between the figure and the chapters. */

.users {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 16px 32px;
    margin-top: 56px;
}

.users p {
    margin: 0;
    font-family: var(--serif);
    font-style: italic;
    font-size: 18px;
    color: var(--soft);
}

.users .logo {
    display: block;
    height: 30px;
    background-color: var(--ink);
    -webkit-mask-size: contain;
    mask-size: contain;
    -webkit-mask-repeat: no-repeat;
    mask-repeat: no-repeat;
    opacity: 0.8;
    transition: opacity 0.2s;
}

.users .logo:hover {
    opacity: 1;
}

.users .yours {
    flex-basis: 100%;
    font-family: var(--vp-font-family-base);
    font-style: normal;
    font-size: 15px;
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
