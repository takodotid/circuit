<script setup lang="ts">
import { ref } from "vue";
import { useData, withBase } from "vitepress";
import circuit from "../../../package.json";
import { catalog } from "../../../src/adapters/devices/catalog";

const install = "npx @takodotid/circuit new";
const copied = ref(false);
const { isDark } = useData();

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

// Networks that run on Circuit in production. Each logo uses the page's ink, so one image works in light and dark.
const users = [{ name: "Tako", logo: "/users/tako.png", link: "https://tako.id", width: 1292, height: 602 }];
</script>

<template>
    <article class="home">
        <header class="opening">
            <div class="opening-copy">
                <h1><span>Your network,</span><span>written down.</span></h1>
                <p class="lead">
                    Circuit keeps the configuration of every router and switch in plain files, in git. Before anything reaches a device,
                    it shows you exactly what would change. Then it makes the device match the file, and nothing else.
                </p>

                <p class="start">
                    Start a project with
                    <button type="button" class="command" @click="copy" :title="copied ? 'Copied' : 'Copy'">{{ install }}</button>
                    <span class="copied" aria-live="polite">{{ copied ? " copied" : "" }}</span>
                    or with pnpm or Bun, or read <a :href="withBase('/guide/introduction')">what Circuit is</a> first.
                </p>
            </div>

            <figure class="section-model" aria-labelledby="figure-caption">
                <img
                    :src="withBase(isDark ? '/illustrations/circuit-section-dark.png' : '/illustrations/circuit-section-light.png')"
                    alt="A section through three Circuit configuration files, a visible change plan and the network devices they define."
                    width="1536"
                    height="1024"
                />
                <figcaption id="figure-caption">One file for each device. What the file says is what the device runs.</figcaption>
            </figure>
        </header>

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
    display: flex;
    flex-direction: column;
    max-width: 1040px;
    margin: 0 auto;
    padding: 56px 16px 120px;
}

.opening {
    order: 0;
}

.chapter:nth-of-type(2) {
    order: 1;
}

.users {
    order: 2;
}

.chapter:nth-of-type(1) {
    order: 3;
}

.chapter:nth-of-type(n + 3) {
    order: 4;
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

/* Daylight Section builds the opening as one cut through files, plan and devices. */
.home {
    --ink: var(--vp-c-text-1);
    --soft: var(--vp-c-text-2);
    --rule: var(--circuit-line);
    --mark: var(--circuit-sun);

    max-width: 1240px;
    padding-top: 48px;
}

.opening {
    display: grid;
    grid-template-columns: minmax(430px, 0.92fr) minmax(540px, 1.35fr);
    align-items: stretch;
    max-width: none;
    min-height: 520px;
    border-block: 1px solid var(--rule);
}

.opening-copy {
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding: 48px 40px 48px 0;
}

h1 {
    max-width: 560px;
    font-family: var(--circuit-font);
    font-size: clamp(54px, 4.7vw, 68px);
    font-weight: 700;
    line-height: 0.92;
    letter-spacing: -0.03em;
}

h1 span {
    display: block;
}

.lead {
    margin-top: 28px;
    max-width: 550px;
    font-size: 19px;
    line-height: 1.55;
}

.command {
    border: 0;
    border-radius: 2px;
    background: var(--circuit-poche);
    color: var(--circuit-limewash);
    font-family: var(--circuit-mono);
    font-weight: 400;
}

.dark .command {
    background: var(--vp-c-bg-soft);
    color: var(--vp-c-text-1);
}

.section-model {
    position: relative;
    display: block;
    min-width: 0;
    margin: 0;
    overflow: hidden;
    border-left: 1px solid var(--rule);
    background: var(--vp-c-bg-soft);
}

.section-model::before {
    content: none;
}

.section-model picture,
.section-model img {
    display: block;
    width: 100%;
    height: 100%;
}

.section-model img {
    object-fit: contain;
    object-position: center;
}

.stratum {
    position: relative;
    z-index: 1;
    min-width: 0;
    padding: 34px;
}

.stratum-name {
    display: block;
    margin-bottom: 16px;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
}

.files-stratum {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
    align-content: end;
    padding-bottom: 58px;
}

.files-stratum .stratum-name {
    grid-column: 1 / -1;
}

.files-stratum pre {
    margin: 0;
    padding: 16px;
    overflow: hidden;
    border: 1px solid var(--rule);
    background: color-mix(in srgb, var(--circuit-surface) 88%, transparent);
    font: 12px/1.55 var(--circuit-mono);
}

.plan-stratum {
    z-index: 3;
    display: grid;
    grid-template-columns: minmax(230px, 1fr) minmax(160px, 0.7fr);
    gap: 22px;
    align-items: center;
    margin: -20px 7% -12px;
    padding: 20px 24px;
    border: 1px solid color-mix(in srgb, var(--circuit-sun) 70%, var(--circuit-poche));
    background: color-mix(in srgb, var(--circuit-sun-fill) 82%, var(--circuit-limewash));
    color: #181a1e;
}

.plan-stratum .stratum-name {
    grid-column: 1 / -1;
    margin: 0;
}

.plan-lines {
    display: grid;
    font: 12px/1.65 var(--circuit-mono);
}

.plan-lines span {
    padding-inline: 8px;
}

.plan-lines .removed {
    color: #7b1721;
    background: #f4d8d9;
}

.plan-lines .added {
    color: #0d5e34;
    background: #d9eddd;
}

.devices-stratum {
    align-content: end;
    padding-top: 54px;
    background: var(--circuit-poche);
    color: #f5f4ec;
}

.device-row {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 12px;
}

.device {
    display: grid;
    grid-template-columns: 1fr;
    padding: 12px;
    border: 1px solid #626a6e;
    background: #22272a;
    font-size: 12px;
}

.device i {
    height: 18px;
    margin-bottom: 12px;
    border: 1px solid #8c9598;
    background: repeating-linear-gradient(90deg, transparent 0 7px, #8c9598 7px 9px);
}

.device small {
    color: #b8bfc1;
}

.section-model figcaption {
    position: absolute;
    z-index: 4;
    right: 18px;
    bottom: 8px;
    max-width: 58%;
    margin: 0;
    padding: 5px 8px;
    background: rgb(20 24 25 / 88%);
    color: #f4f0e5;
    font: 12px/1.4 var(--circuit-font);
}

.users {
    padding-block: 28px;
    border-bottom: 1px solid var(--rule);
}

.users p,
h2,
.patterns dt {
    font-family: var(--circuit-font);
    font-style: normal;
}

h2 {
    font-weight: 700;
    letter-spacing: 0.02em;
}

.chapter {
    border-top-width: 2px;
}

.steps li::before {
    font-family: var(--circuit-font);
    font-style: normal;
    font-weight: 700;
}

@media (max-width: 900px) {
    .opening {
        grid-template-columns: 1fr;
        min-height: 0;
    }

    .opening-copy {
        padding: 42px 0;
    }

    .section-model {
        min-height: 0;
        aspect-ratio: 3 / 2;
        border-top: 1px solid var(--rule);
        border-left: 0;
    }
}

@media (max-width: 560px) {
    .home {
        padding-top: 22px;
    }

    .opening-copy {
        padding: 30px 0 34px;
    }

    h1 {
        font-size: clamp(50px, 15vw, 66px);
    }

    .lead {
        font-size: 17px;
    }

    .start {
        line-height: 1.7;
    }

    .command {
        display: block;
        width: 100%;
        margin-block: 8px;
        padding: 10px 12px;
        text-align: left;
    }

    .section-model {
        min-height: 0;
    }

    .section-model img {
        object-position: 51% center;
    }

    .section-model figcaption {
        position: static;
        max-width: none;
        padding: 10px 12px;
        background: var(--circuit-poche);
        color: var(--circuit-limewash);
    }
}

/* The first screen is one product explanation: promise, mechanism and sequence. */
@media (min-width: 901px) {
    .home {
        max-width: 1380px;
        padding: 28px 28px 128px;
    }

    .opening {
        grid-template-columns: minmax(390px, 0.78fr) minmax(650px, 1.42fr);
        min-height: 500px;
    }

    .opening-copy {
        padding: 40px 48px 40px 12px;
    }

    h1 {
        max-width: 500px;
        font-size: clamp(58px, 4.6vw, 72px);
        line-height: 0.9;
    }

    .lead {
        max-width: 500px;
        margin-top: 26px;
        font-size: 17px;
        line-height: 1.5;
    }

    .start {
        max-width: 510px;
        margin-top: 24px;
        font-size: 14px;
        line-height: 1.65;
    }

    .command {
        display: inline-block;
        margin-block: 4px;
        padding: 8px 12px;
    }

    .chapter:nth-of-type(2) {
        grid-template-columns: 128px minmax(0, 1fr);
        gap: 24px;
        margin-top: 0;
        padding: 22px 0 24px;
        border-top: 0;
        border-bottom: 2px solid var(--rule);
    }

    .chapter:nth-of-type(2) h2 {
        padding: 5px 0 0 12px;
        font-size: 13px;
        letter-spacing: 0.12em;
        text-transform: uppercase;
    }

    .chapter:nth-of-type(2) .text {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: end;
        gap: 14px 24px;
    }

    .chapter:nth-of-type(2) .steps {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        margin: 0;
    }

    .chapter:nth-of-type(2) .steps li {
        min-height: 78px;
        margin: 0;
        padding: 4px 18px 0 54px;
        border-left: 1px solid var(--rule);
        font-size: 14px;
        line-height: 1.45;
    }

    .chapter:nth-of-type(2) .steps li::before {
        left: 16px;
        top: -2px;
        font-size: 28px;
        line-height: 1;
    }

    .chapter:nth-of-type(2) .text p {
        margin: 0;
        white-space: nowrap;
    }

    .users {
        margin-top: 46px;
    }
}

@media (min-width: 901px) and (max-width: 1160px) {
    .opening {
        grid-template-columns: minmax(350px, 0.9fr) minmax(520px, 1.1fr);
    }

    .chapter:nth-of-type(2) {
        grid-template-columns: 1fr;
    }

    .chapter:nth-of-type(2) h2 {
        padding-left: 0;
    }

    .chapter:nth-of-type(2) .text {
        grid-template-columns: 1fr;
    }
}
</style>
