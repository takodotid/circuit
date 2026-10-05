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

const platforms = [
    { name: "MikroTik RouterOS 7", platform: "routeros" },
    { name: "Huawei VRP", platform: "vrp" },
    { name: "Raisecom ROS", platform: "raisecom-ros" },
].map((entry) => ({ ...entry, models: Object.keys(catalog[entry.platform as keyof typeof catalog]) }));

const steps = [
    { command: "edit switch.ts", text: "Say how the device should be: its VLANs, ports, addresses, routing, firewall." },
    { command: "bun circuit validate", text: "Typos, missing values and anything the device cannot do are caught here." },
    { command: "bun circuit diff", text: "See every command that would change, without touching the device." },
    { command: "bun circuit apply switch --confirm", text: "Send it. The change is kept only if Circuit can still log in." },
];

const beliefs = [
    {
        title: "The file is the whole truth",
        text: "A port the file does not mention is shut down, a user it does not list is removed. Nothing stays on a device because nobody wrote it down.",
    },
    { title: "Leave it out to turn it off", text: "You only write what is on. There is no enabled: false." },
    {
        title: "One way to write it, every vendor",
        text: "access_vlan becomes MikroTik, Huawei or Raisecom commands. A field a device cannot do is an error, never skipped.",
    },
    {
        title: "Typos never reach a device",
        text: "Every VLAN, port and policy name is checked in your editor, which suggests the names that exist.",
    },
    { title: "Secrets stay out of git", text: 'A password is secret("NAME"), read from .env or 1Password only when a command is sent.' },
    { title: "Made for AI agents too", text: "Every project has an AGENTS.md. An agent can plan any change; only you confirm it." },
];

const patterns = [
    {
        title: "A single site",
        text: "A home, an office or an internal network. A router and a switch, no BGP.",
        link: "/patterns/single-site",
    },
    { title: "An edge router", text: "Your own AS number, with an IP transit and an internet exchange.", link: "/patterns/edge-router" },
    {
        title: "Colocation with tenants",
        text: "Customers who each get their own VLANs, addresses and ports.",
        link: "/patterns/colocation",
    },
];
</script>

<template>
    <div class="home">
        <section class="hero">
            <div class="intro">
                <p class="badge"><span class="dot" />v{{ circuit.version }}, alpha</p>
                <h1>Your network,<br />written down.</h1>
                <p class="lead">
                    Write how each router and switch should be configured, one TypeScript file per device. Circuit shows you every command
                    that would change, then makes the device match.
                </p>

                <button class="install" type="button" @click="copy" :aria-label="`Copy ${install}`">
                    <span class="prompt">$</span>
                    <code>{{ install }}</code>
                    <span class="copy">{{ copied ? "copied" : "copy" }}</span>
                </button>

                <div class="actions">
                    <a class="button primary" :href="withBase('/guide/getting-started')">Get started</a>
                    <a class="button" :href="withBase('/guide/introduction')">What Circuit is</a>
                </div>
            </div>

            <div class="demo" aria-label="A change to a file, and the plan Circuit makes from it">
                <div class="window">
                    <div class="bar"><span>switch.ts</span></div>
                    <pre><code><span class="muted">vlans: {</span>
<span class="muted">    ...</span>
<span class="add">    cameras: { id: 40, description: "Cameras" },</span>
<span class="muted">},</span>
<span class="muted">ports: {</span>
<span class="muted">    "10g-1": { trunk_vlans: ["mgmt", "home", "guests", </span><span class="add">"cameras"</span><span class="muted">] },</span>
<span class="add">    "10g-5": { description: "Camera, gate", access_vlan: "cameras" },</span>
<span class="muted">},</span></code></pre>
                </div>

                <div class="link" aria-hidden="true"><span /></div>

                <div class="window">
                    <div class="bar"><span>$ bun circuit diff switch</span></div>
                    <pre><code><span class="title">vlan 40</span>
<span class="add">  + name cameras</span>
<span class="add">  + description Cameras</span>
<span class="title">(top level)</span>
<span class="add">  + vlan batch 40</span>
<span class="title">interface 10GE1/0/1</span>
<span class="remove">  - port trunk allow-pass vlan 10 20 30</span>
<span class="add">  + port trunk allow-pass vlan 10 20 30 40</span>
<span class="title">interface 10GE1/0/5</span>
<span class="remove">  - shutdown</span>
<span class="add">  + description Camera, gate</span>
<span class="add">  + port default vlan 40</span></code></pre>
                </div>
            </div>
        </section>

        <section class="section">
            <h2><span class="index">01</span>From a file to a device</h2>
            <ol class="path">
                <li v-for="(step, index) in steps" :key="step.command">
                    <span class="node">{{ index + 1 }}</span>
                    <code>{{ step.command }}</code>
                    <p>{{ step.text }}</p>
                </li>
            </ol>
        </section>

        <section class="section">
            <h2><span class="index">02</span>What Circuit believes</h2>
            <div class="beliefs">
                <div v-for="belief in beliefs" :key="belief.title" class="belief">
                    <h3>{{ belief.title }}</h3>
                    <p>{{ belief.text }}</p>
                </div>
            </div>
        </section>

        <section class="section">
            <h2><span class="index">03</span>Start from a pattern</h2>
            <div class="patterns">
                <a v-for="pattern in patterns" :key="pattern.link" class="pattern" :href="withBase(pattern.link)">
                    <h3>{{ pattern.title }}</h3>
                    <p>{{ pattern.text }}</p>
                    <span class="more">See the files</span>
                </a>
            </div>
        </section>

        <section class="section">
            <h2><span class="index">04</span>Devices</h2>
            <div class="platforms">
                <a v-for="entry in platforms" :key="entry.platform" class="platform" :href="withBase(`/platforms/${entry.platform}`)">
                    <code>{{ entry.platform }}</code>
                    <h3>{{ entry.name }}</h3>
                    <p>Proved on {{ entry.models.join(", ") }}</p>
                </a>
            </div>
        </section>

        <section class="alpha">
            <p>
                <strong>Alpha.</strong> Circuit runs a production network, but the way you write config, the commands and the supported
                devices can still change between releases. Install an exact version, and read the
                <a :href="`${circuit.repository.url.replace(/^git\+/, '').replace(/\.git$/, '')}/releases`">release notes</a>
                before you upgrade.
            </p>
        </section>
    </div>
</template>

<style scoped>
.home {
    --signal: #0f9f6e;
    --signal-soft: rgba(15, 159, 110, 0.12);
    --cut: #d1495b;
    --mono: ui-monospace, "SFMono-Regular", "JetBrains Mono", Menlo, Consolas, monospace;

    max-width: 1152px;
    margin: 0 auto;
    padding: 32px 16px 96px;
}

@media (min-width: 640px) {
    .home {
        padding: 48px 24px 96px;
    }
}

.dark .home {
    --signal: #3ddc97;
    --signal-soft: rgba(61, 220, 151, 0.12);
    --cut: #ff7b8a;
}

/* Hero */

.hero {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 48px;
    align-items: center;
    padding: 24px 0 64px;
}

@media (min-width: 960px) {
    .hero {
        grid-template-columns: minmax(0, 1fr) minmax(0, 1.05fr);
        padding: 56px 0 88px;
    }
}

.badge {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    margin: 0 0 20px;
    padding: 4px 12px;
    border: 1px solid var(--vp-c-divider);
    border-radius: 999px;
    font-family: var(--mono);
    font-size: 13px;
    color: var(--vp-c-text-2);
}

.dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--signal);
    box-shadow: 0 0 0 4px var(--signal-soft);
}

h1 {
    margin: 0;
    font-size: clamp(40px, 7vw, 64px);
    line-height: 1.05;
    letter-spacing: -0.03em;
    font-weight: 700;
    color: var(--vp-c-text-1);
}

.lead {
    margin: 20px 0 28px;
    max-width: 520px;
    font-size: 18px;
    line-height: 1.6;
    color: var(--vp-c-text-2);
}

.install {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    max-width: 440px;
    padding: 12px 16px;
    border: 1px solid var(--vp-c-divider);
    border-radius: 10px;
    background: var(--vp-c-bg-soft);
    font-family: var(--mono);
    font-size: 15px;
    text-align: left;
    cursor: pointer;
    transition: border-color 0.2s;
}

.install:hover {
    border-color: var(--signal);
}

.install code {
    flex: 1;
    min-width: 0;
    overflow-x: auto;
    white-space: nowrap;
    background: none;
    padding: 0;
    color: var(--vp-c-text-1);
}

.prompt {
    color: var(--signal);
}

.copy {
    font-size: 12px;
    color: var(--vp-c-text-3);
}

.actions {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    margin-top: 20px;
}

.button {
    padding: 10px 20px;
    border: 1px solid var(--vp-c-divider);
    border-radius: 999px;
    font-weight: 600;
    font-size: 15px;
    color: var(--vp-c-text-1);
    text-decoration: none;
    transition:
        border-color 0.2s,
        background 0.2s;
}

.button:hover {
    border-color: var(--vp-c-text-2);
}

.button.primary {
    border-color: var(--vp-c-text-1);
    background: var(--vp-c-text-1);
    color: var(--vp-c-bg);
}

.button.primary:hover {
    opacity: 0.85;
}

/* The file and its plan */

/* On a dotted board, like a patch panel. */
.demo {
    display: flex;
    flex-direction: column;
    min-width: 0;
    padding: 12px;
    border-radius: 16px;
    background-image: radial-gradient(var(--vp-c-divider) 1px, transparent 1px);
    background-size: 18px 18px;
}

.window {
    border: 1px solid var(--vp-c-divider);
    border-radius: 12px;
    background: var(--vp-c-bg-soft);
    overflow: hidden;
}

.bar {
    padding: 10px 16px;
    border-bottom: 1px solid var(--vp-c-divider);
    font-family: var(--mono);
    font-size: 12px;
    color: var(--vp-c-text-2);
}

.window pre {
    margin: 0;
    padding: 14px 16px;
    overflow-x: auto;
    font-family: var(--mono);
    font-size: 12.5px;
    line-height: 1.65;
}

.window code {
    background: none;
    padding: 0;
    font-size: inherit;
    color: var(--vp-c-text-1);
}

.window .muted {
    color: var(--vp-c-text-3);
}

.window .add {
    color: var(--signal);
}

.window .remove {
    color: var(--cut);
}

.window .title {
    color: var(--vp-c-text-2);
}

/* A cable between the two windows. */
.link {
    display: flex;
    justify-content: center;
    height: 36px;
}

.link span {
    position: relative;
    width: 2px;
    background: repeating-linear-gradient(to bottom, var(--signal) 0 6px, transparent 6px 12px);
    background-size: 2px 12px;
    animation: flow 1s linear infinite;
}

@keyframes flow {
    from {
        background-position: 0 0;
    }
    to {
        background-position: 0 12px;
    }
}

@media (prefers-reduced-motion: reduce) {
    .link span {
        animation: none;
    }
}

/* Sections */

.section {
    padding: 48px 0;
    border-top: 1px solid var(--vp-c-divider);
}

h2 {
    display: flex;
    align-items: baseline;
    gap: 14px;
    margin: 0 0 28px;
    padding: 0;
    border: none;
    font-size: 26px;
    letter-spacing: -0.01em;
    color: var(--vp-c-text-1);
}

.index {
    font-family: var(--mono);
    font-size: 14px;
    color: var(--signal);
}

h3 {
    margin: 0 0 8px;
    font-size: 17px;
    font-weight: 600;
    color: var(--vp-c-text-1);
}

p {
    margin: 0;
    line-height: 1.6;
    color: var(--vp-c-text-2);
}

/* The path, like hops on a trace. */
.path {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 28px;
    margin: 0;
    padding: 0;
    list-style: none;
    counter-reset: none;
}

@media (min-width: 768px) {
    .path {
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 20px;
    }
}

.path li {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 10px;
}

@media (min-width: 768px) {
    .path li:not(:last-child)::after {
        content: "";
        position: absolute;
        top: 15px;
        left: 40px;
        right: -12px;
        height: 2px;
        background: var(--vp-c-divider);
    }
}

.node {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border: 2px solid var(--signal);
    border-radius: 50%;
    background: var(--vp-c-bg);
    font-family: var(--mono);
    font-size: 13px;
    font-weight: 600;
    color: var(--signal);
}

.path code {
    align-self: flex-start;
    max-width: 100%;
    overflow-x: auto;
    white-space: nowrap;
    font-family: var(--mono);
    font-size: 13px;
}

.beliefs {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 1px;
    border: 1px solid var(--vp-c-divider);
    border-radius: 12px;
    background: var(--vp-c-divider);
    overflow: hidden;
}

@media (min-width: 640px) {
    .beliefs {
        grid-template-columns: repeat(2, minmax(0, 1fr));
    }
}

@media (min-width: 960px) {
    .beliefs {
        grid-template-columns: repeat(3, minmax(0, 1fr));
    }
}

.belief {
    padding: 22px;
    background: var(--vp-c-bg);
}

.patterns,
.platforms {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 16px;
}

@media (min-width: 768px) {
    .patterns,
    .platforms {
        grid-template-columns: repeat(3, minmax(0, 1fr));
    }
}

.pattern,
.platform {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 22px;
    border: 1px solid var(--vp-c-divider);
    border-radius: 12px;
    color: inherit;
    text-decoration: none;
    transition: border-color 0.2s;
}

.pattern:hover,
.platform:hover {
    border-color: var(--signal);
}

.pattern h3,
.platform h3 {
    margin: 0;
}

.more {
    margin-top: auto;
    padding-top: 10px;
    font-size: 14px;
    font-weight: 600;
    color: var(--signal);
}

.platform code {
    align-self: flex-start;
    font-family: var(--mono);
    font-size: 12px;
    color: var(--signal);
}

.alpha {
    margin-top: 24px;
    padding: 18px 22px;
    border: 1px dashed var(--vp-c-divider);
    border-radius: 12px;
}

.alpha a {
    color: var(--vp-c-text-1);
    text-decoration: underline;
}
</style>
