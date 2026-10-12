<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useData, withBase } from "vitepress";
import circuit from "../../../package.json";
import { catalog } from "../../../src/adapters/devices/catalog";
import { data as templateFiles } from "./templates.data";

const { isDark } = useData();

const install = "npx @takodotid/circuit new";

// The command last copied, which says so for a moment.
const copied = ref("");

async function copy(command: string) {
    await navigator.clipboard.writeText(command);
    copied.value = command;
    setTimeout(() => (copied.value = ""), 1500);
}

const repository = circuit.repository.url.replace(/^git\+/, "").replace(/\.git$/, "");
const releases = `${repository}/releases`;
const npm = `https://www.npmjs.com/package/${circuit.name}`;

// Starting a project with each package manager, as the getting started page writes it.
const starters = [
    { name: "npm", command: install },
    { name: "pnpm", command: "pnpm dlx @takodotid/circuit new" },
    { name: "Bun", command: "bunx @takodotid/circuit new" },
];
const starter = ref(0);

const steps = [
    {
        title: "Change the file.",
        text: "VLANs, ports, addresses, routing, firewall: the same words for every vendor. Your editor checks every name as you type.",
        command: "edge-b1.ts",
        file: true,
    },
    {
        title: "Check it.",
        text: "Circuit catches what a device cannot do, and any rule of your own that the change breaks.",
        command: "npx circuit validate",
    },
    {
        title: "Read the plan.",
        text: "Every command that would be sent, in the vendor's own language, before anything is sent.",
        command: "npx circuit diff",
    },
    {
        title: "Confirm.",
        text: "Circuit applies the change the safest way the device allows, and keeps it only once it can still log in afterwards.",
        command: "npx circuit apply edge-b1 --confirm",
    },
];

const patterns = [
    { name: "A single site", id: "single-site", text: "A home, an office or an internal network. A router and a switch, no BGP." },
    { name: "An edge router", id: "edge-router", text: "Your own AS number, with an IP transit and an internet exchange." },
    { name: "Colocation with tenants", id: "colocation", text: "Customers who each get their own VLANs, addresses and ports." },
].map((pattern) => ({ ...pattern, files: templateFiles[pattern.id] ?? [] }));

const platforms = [
    { name: "MikroTik RouterOS 7", platform: "routeros" },
    { name: "Huawei VRP", platform: "vrp" },
    { name: "Raisecom ROS", platform: "raisecom-ros" },
].map((entry) => ({ ...entry, models: Object.keys(catalog[entry.platform as keyof typeof catalog]) }));

// Networks that run on Circuit in production. Each logo uses the page's ink, so one image works in light and dark.
const users = [{ name: "Tako", logo: "/users/tako.png", link: "https://tako.id", width: 1292, height: 602 }];

const studioShot = computed(() => withBase(isDark.value ? "/screenshots/studio-dark.png" : "/screenshots/studio-light.png"));

// The drawing is laid out on a 1536-pixel-wide frame whose band starts 230 pixels down; everything in it scales with the band's width.
const FRAME = 15.36;
const TOP = 230;

const cq = (pixels: number) => `${(pixels / FRAME).toFixed(3)}cqw`;

/** The parts of the drawing, each a numbered callout pointing at its place and an entry in the legend under it. */
const parts = [
    {
        name: "Device file",
        link: "/guide/devices",
        meaning: "One TypeScript file for each router or switch. Your editor checks every name as you type.",
        callout: [117, 255],
        target: [178, 290],
    },
    {
        name: "Check",
        link: "/guide/network#checks",
        meaning: "A rule about your network that every change must pass, run on all devices together.",
        callout: [1219, 267],
        target: [1165, 312],
    },
    {
        name: "Plan",
        link: "/guide/convergence#making-the-plan",
        meaning: "Every command that would be sent, in the device's own language, before anything is sent.",
        callout: [830, 266],
        target: [778, 320],
    },
    {
        name: "Apply",
        link: "/guide/convergence",
        meaning: "Sends the plan only when you confirm it, the safest way the device allows.",
        callout: [1006, 303],
        target: [968, 352],
    },
    {
        name: "Snapshot",
        link: "/guide/glossary",
        meaning: "What a device ran when Circuit last read it, kept in .circuit/state/.",
        callout: [1452, 296],
        target: [1424, 355],
    },
    {
        name: "Git history",
        link: "/studio/changes",
        meaning: "Every change, with its author and its reason, in your own repository.",
        callout: [1405, 567],
        target: [1319, 612],
    },
].map((part, index) => {
    const [x, y] = part.callout;
    const [tx, ty] = part.target;

    return {
        ...part,
        number: index + 1,
        style: {
            "--x": cq(x),
            "--y": cq(y - TOP),
            "--length": cq(Math.hypot(tx - x, ty - y)),
            "--angle": `${((Math.atan2(ty - y, tx - x) * 180) / Math.PI).toFixed(1)}deg`,
            "--order": index,
        },
    };
});

// The part a visitor points at, by number: its callout and its legend entry light up together.
const active = ref(0);

/** A label set into the drawing, at its place on the frame. */
const at = (x: number, y: number) => ({ left: cq(x), top: cq(y - TOP) });

// Each plate is a 1536 by 1024 drawing fitted whole into its box on the frame.
const plates = {
    editor: { x: 0, y: 236, w: 600, h: 420 },
    plan: { x: 430, y: 250, w: 620, h: 406 },
    network: { x: 960, y: 272, w: 576, h: 384 },
};

/** A label set into a plate, at a point of the plate's own drawing. */
function on(plate: keyof typeof plates, x: number, y: number) {
    const box = plates[plate];
    const scale = Math.min(box.w / 1536, box.h / 1024);

    return at(box.x + (box.w - 1536 * scale) / 2 + x * scale, box.y + (box.h - 1024 * scale) / 2 + y * scale);
}

// Each plate as drawn.
const arts = [
    { plate: "editor", src: "/illustrations/home/plate-editor.webp" },
    { plate: "plan", src: "/illustrations/home/plate-plan.webp" },
    { plate: "network", src: "/illustrations/home/plate-network.webp" },
] as const;

const box = (plate: keyof typeof plates) => {
    const { x, y, w, h } = plates[plate];
    return { left: cq(x), top: cq(y - TOP), width: cq(w), height: cq(h) };
};

// The editor in the drawing leans away to the right. Its words are set flat on a window of this size, then bent onto the
// editor's four corners in the drawing, so they lean with it.
const WINDOW = { width: 870, height: 760 };
const EDITOR = [
    [580, 92],
    [1450, 150],
    [1450, 850],
    [580, 855],
];

const stage = ref<HTMLElement>();
const windowStyle = ref<Record<string, string>>({ visibility: "hidden" });

/** The CSS transform that bends a flat box of the window's size onto four corners, given clockwise from the top left. */
function bend(corners: number[][]) {
    const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = corners as [number, number][];
    const dx1 = x1 - x2;
    const dx2 = x3 - x2;
    const dx3 = x0 - x1 + x2 - x3;
    const dy1 = y1 - y2;
    const dy2 = y3 - y2;
    const dy3 = y0 - y1 + y2 - y3;
    const denominator = dx1 * dy2 - dx2 * dy1;
    const g = (dx3 * dy2 - dx2 * dy3) / denominator;
    const h = (dx1 * dy3 - dx3 * dy1) / denominator;

    const a = (x1 - x0 + g * x1) / WINDOW.width;
    const b = (x3 - x0 + h * x3) / WINDOW.height;
    const d = (y1 - y0 + g * y1) / WINDOW.width;
    const e = (y3 - y0 + h * y3) / WINDOW.height;

    return `matrix3d(${[a, d, 0, g / WINDOW.width, b, e, 0, h / WINDOW.height, 0, 0, 1, 0, x0, y0, 0, 1].join(",")})`;
}

/** Bend the editor's words onto the drawing at the width the drawing has now. */
function fitWindow() {
    if (!stage.value) return;

    const box = plates.editor;
    const scale = Math.min(box.w / 1536, box.h / 1024);
    const left = box.x + (box.w - 1536 * scale) / 2;
    const top = box.y - TOP + (box.h - 1024 * scale) / 2;
    const pixels = stage.value.clientWidth / 1536;

    const corners = EDITOR.map(([x, y]) => [(left + x * scale) * pixels, (top + y * scale) * pixels]);
    windowStyle.value = { width: `${WINDOW.width}px`, height: `${WINDOW.height}px`, transform: bend(corners) };
}

let watcher: ResizeObserver | undefined;

onMounted(() => {
    fitWindow();
    watcher = new ResizeObserver(fitWindow);
    if (stage.value) watcher.observe(stage.value);
});

onBeforeUnmount(() => watcher?.disconnect());

const nodes = [
    { name: "core-a1", x: 710, y: 240 },
    { name: "edge-b1", x: 455, y: 408, changed: true },
    { name: "edge-a1", x: 915, y: 403 },
    { name: "agg-b1", x: 478, y: 597 },
    { name: "tor-b1", x: 855, y: 612 },
];

// The git history under the drawing: a commit at each station, the newest the change in the plan.
const commits = [
    { hash: "4f2c1a0", message: "add tor-b1", x: 155 },
    { hash: "9be71d3", message: "fix mtu", x: 432 },
    { hash: "e05b6c8", message: "tor-a2 ports", x: 708 },
    { hash: "c03a8e5", message: "add sirius", x: 957 },
];
</script>

<template>
    <article class="home">
        <header class="hero">
            <h1>Your network, written down.</h1>

            <figure class="plate" aria-labelledby="plate-caption">
                <div ref="stage" class="stage" @mouseleave="active = 0">
                    <img
                        v-for="(art, index) in arts"
                        :key="art.plate"
                        class="art"
                        :style="box(art.plate)"
                        :src="withBase(art.src)"
                        alt=""
                        width="1152"
                        height="768"
                        :fetchpriority="index === 0 ? 'high' : undefined"
                    />

                    <div class="set" aria-hidden="true">
                        <div class="window" :style="windowStyle">
                            <span class="tab">edge-b1.ts</span>
                            <pre class="code"><span class="k">export default</span> <span class="f">defineDevice</span>({
  name: <span class="s">"edge-b1"</span>,
  platform: <span class="s">"routeros"</span>,
  vlans: { sirius: { id: <span class="n">1012</span> } },
  interfaces: {
    sirius: {
      type: <span class="s">"vlan"</span>,
      vlan: <span class="s">"sirius"</span>,
      addresses: [<span class="s">"198.51.100.169/29"</span>],
    },
  },
});</pre>
                        </div>

                        <div class="sheet" :style="on('plan', 306, 108)">
                            <b>edge-b1: 4 commands in 3 steps</b>
                            <span>/interface vlan</span>
                            <span class="removed">- add name=test vlan-id=999</span>
                            <span class="added">+ add name=sirius vlan-id=1012</span>
                            <span>/interface bridge vlan</span>
                            <span class="added">+ add bridge=bridge vlan-ids=1012</span>
                            <span>/ip address</span>
                            <span class="added">+ add address=198.51.100.169/29</span>
                            <span class="added">&nbsp; interface=sirius</span>
                        </div>

                        <span class="apply" :style="on('plan', 1300, 282)">Apply</span>

                        <span class="board-title" :style="on('network', 349, 112)">Network</span>
                        <span
                            v-for="node in nodes"
                            :key="node.name"
                            class="node"
                            :class="{ changed: node.changed }"
                            :style="on('network', node.x, node.y)"
                        >
                            {{ node.name }}
                        </span>

                        <span class="card-title" :style="on('network', 1088, 304)">Snapshot</span>
                        <span class="card-name" :style="on('network', 1181, 420)">edge-b1</span>
                        <span class="card-date" :style="on('network', 1181, 462)">2026-10-12</span>

                        <span v-for="commit in commits" :key="commit.hash" class="commit" :style="on('network', commit.x, 772)">
                            <code>{{ commit.hash }}</code>
                            {{ commit.message }}
                        </span>
                    </div>

                    <a
                        v-for="part in parts"
                        :key="part.number"
                        class="callout"
                        :class="{ lit: active === part.number }"
                        :href="withBase(part.link)"
                        :style="part.style"
                        :aria-label="`${part.number}: ${part.name}`"
                        @mouseenter="active = part.number"
                        @focus="active = part.number"
                        @blur="active = 0"
                    >
                        <span class="leader" aria-hidden="true" />
                        <span class="dot">{{ part.number }}</span>
                        <span class="tag" role="tooltip">
                            <strong>{{ part.name }}</strong>
                            {{ part.meaning }}
                        </span>
                    </a>
                </div>

                <p class="swipe onward" aria-hidden="true">Swipe the drawing to see all six parts</p>

                <figcaption id="plate-caption" class="visually-hidden">
                    How a change travels: an engineer writes a device file, a teammate reads the plan it makes, Apply sends it, the network
                    drawing shows the changed device, its snapshot is kept, and the git history records the change.
                </figcaption>
            </figure>

            <ol class="legend" @mouseleave="active = 0">
                <li v-for="part in parts" :key="part.number">
                    <a
                        :href="withBase(part.link)"
                        :class="{ lit: active === part.number }"
                        :title="part.meaning"
                        @mouseenter="active = part.number"
                        @focus="active = part.number"
                        @blur="active = 0"
                    >
                        <span class="dot" aria-hidden="true">{{ part.number }}</span>
                        {{ part.name }}
                    </a>
                </li>
            </ol>

            <div class="start">
                <p class="lead">Before anything reaches a device, Circuit shows you exactly what would change.</p>
                <a class="cta" :href="withBase('/guide/getting-started')">
                    Get started
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h15m-6-6 6 6-6 6" /></svg>
                </a>
                <button type="button" class="command" @click="copy(install)" :aria-label="`Copy ${install}`">
                    <code>{{ install }}</code>
                    <span class="copied" aria-live="polite">{{ copied === install ? "Copied" : "" }}</span>
                    <svg v-if="copied !== install" viewBox="0 0 24 24" aria-hidden="true">
                        <rect x="8" y="8" width="12" height="12" rx="1" />
                        <path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" />
                    </svg>
                </button>
            </div>
        </header>

        <section class="chapter why" aria-labelledby="why">
            <h2 id="why"><span>Why</span></h2>
            <div class="body">
                <p>
                    A network configured by hand drifts. Someone adds a VLAN during an outage, someone else tests a firewall rule and
                    forgets it, and a year later nobody knows why a port is on. The device is the only record, and it does not say who
                    changed what, or why.
                </p>
                <p>With Circuit the record is the file. Whatever the file leaves out does not stay on the device:</p>
                <table class="ledger">
                    <thead>
                        <tr>
                            <th scope="col">Not in the file</th>
                            <th scope="col">On the device</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <th scope="row">A port</th>
                            <td>is shut down</td>
                        </tr>
                        <tr>
                            <th scope="row">A user</th>
                            <td>is removed</td>
                        </tr>
                        <tr>
                            <th scope="row">A service</th>
                            <td>is off</td>
                        </tr>
                    </tbody>
                </table>
                <p>And git keeps every change, with its author and its reason.</p>
            </div>
        </section>

        <section class="chapter how" aria-labelledby="how">
            <h2 id="how"><span>How</span></h2>
            <div class="body">
                <ol class="steps">
                    <li v-for="(step, index) in steps" :key="step.title">
                        <span class="dot" aria-hidden="true">{{ index + 1 }}</span>
                        <p>
                            <strong>{{ step.title }}</strong> {{ step.text }}
                        </p>
                        <code :class="{ file: step.file }">{{ step.command }}</code>
                    </li>
                </ol>
                <a class="onward" :href="withBase('/guide/getting-started')">Get started</a>
            </div>
        </section>

        <section class="chapter begin" aria-labelledby="begin">
            <h2 id="begin"><span>Where to begin</span></h2>
            <div class="body">
                <p>Pick the layout closest to your network. Each one is a working project you change to your own.</p>
                <ol class="patterns">
                    <li v-for="pattern in patterns" :key="pattern.id">
                        <a :href="withBase(`/patterns/${pattern.id}`)">{{ pattern.name }}</a>
                        <p>{{ pattern.text }}</p>
                        <ul class="files" :aria-label="`Files in ${pattern.name}`">
                            <li v-for="file in pattern.files" :key="file">{{ file }}</li>
                        </ul>
                    </li>
                </ol>
            </div>
        </section>

        <section class="studio" aria-labelledby="studio">
            <div class="studio-copy">
                <h2 id="studio">The whole network, drawn</h2>
                <p>
                    <code>circuit studio</code> draws the network and lists everything your files hold, so the whole team can look things
                    up, including people who do not read TypeScript. It reads only the files and the last snapshot, and never logs in to a
                    device.
                </p>
                <a class="onward" :href="withBase('/studio/')">Circuit Studio</a>
            </div>
            <img
                class="shot"
                :src="studioShot"
                alt="Circuit Studio's graph of an example network, with the devices that differ from their snapshots marked, beside the layer's details."
                width="1440"
                height="900"
                loading="lazy"
            />
        </section>

        <section class="chapter runs" aria-labelledby="runs">
            <h2 id="runs"><span>What it runs on</span></h2>
            <div class="body">
                <table class="proved">
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
                        <tr v-for="entry in platforms" :key="entry.platform">
                            <th scope="row">
                                <a :href="withBase(`/platforms/${entry.platform}`)">{{ entry.name }}</a>
                            </th>
                            <td>
                                <code v-for="model in entry.models" :key="model">{{ model }}</code>
                            </td>
                        </tr>
                    </tbody>
                </table>

                <aside class="caution">
                    <strong>Alpha</strong>
                    <p>
                        Circuit is young. It runs a production network, but the way you write config can still change between releases, so
                        install an exact version and read the <a :href="releases">release notes</a> before you upgrade.
                    </p>
                </aside>

                <div class="users">
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
                </div>
            </div>
        </section>

        <section class="close" aria-labelledby="close">
            <h2 id="close">Write down your first device.</h2>
            <p>
                Circuit asks a few questions, then writes a working project and installs itself with the package manager you started it
                with.
            </p>
            <div class="starter">
                <div class="managers" role="tablist" aria-label="Package manager">
                    <button
                        v-for="(entry, index) in starters"
                        :key="entry.name"
                        type="button"
                        role="tab"
                        :aria-selected="starter === index"
                        @click="starter = index"
                    >
                        {{ entry.name }}
                    </button>
                </div>
                <button
                    type="button"
                    class="command"
                    @click="copy(starters[starter].command)"
                    :aria-label="`Copy ${starters[starter].command}`"
                >
                    <code>{{ starters[starter].command }}</code>
                    <span class="copied" aria-live="polite">{{ copied === starters[starter].command ? "Copied" : "" }}</span>
                    <svg v-if="copied !== starters[starter].command" viewBox="0 0 24 24" aria-hidden="true">
                        <rect x="8" y="8" width="12" height="12" rx="1" />
                        <path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" />
                    </svg>
                </button>
            </div>
            <p class="more">
                Or read <a :href="withBase('/guide/introduction')">what Circuit is</a> first, follow
                <a :href="withBase('/guide/getting-started')">getting started</a>, or see the package on <a :href="npm">npm</a>.
            </p>
        </section>
    </article>
</template>

<style scoped>
/* Lengths in the opening follow the width of the window, as the approved drawing was laid out at 1536 pixels: 1px there is 0.0651vw. */
.home {
    --gutter: 3.65vw;
    --px: 0.0651vw;
}

.hero :focus-visible,
.studio :focus-visible {
    outline-color: #ffffff;
}

.hero {
    padding: calc(34 * var(--px)) 0 calc(31 * var(--px));
    background: var(--circuit-cobalt);
    color: var(--circuit-on-cobalt);
}

h1 {
    margin: 0;
    padding: 0 var(--gutter);
    font-family: var(--circuit-font);
    font-size: calc(124 * var(--px));
    font-weight: 700;
    font-stretch: 94%;
    line-height: 0.94;
    letter-spacing: -0.035em;
    white-space: nowrap;
}

/* The drawing: three plates on the cobalt, the words set into them, and the numbered callouts over them. */

.plate {
    margin: 0;
}

.swipe {
    display: none;
}

.stage {
    position: relative;
    width: 100%;
    aspect-ratio: 1536 / 426;
    container-type: inline-size;
}

.art {
    position: absolute;
    object-fit: contain;
    pointer-events: none;
    user-select: none;
}

.set > * {
    position: absolute;
    margin: 0;
    white-space: pre;
    pointer-events: none;
}

.window {
    left: 0;
    top: 0;
    transform-origin: 0 0;
}

.window > * {
    position: absolute;
    margin: 0;
}

.tab {
    left: 82px;
    top: 38px;
    color: #ffffff;
    font: 600 18px/1 var(--circuit-mono);
}

.code {
    left: 34px;
    top: 128px;
    padding: 0;
    color: #dfe7f8;
    background: none;
    font: 30px/1.42 var(--circuit-mono);
}

.code .k {
    color: #ff9db0;
}

.code .f {
    color: #8fc2ff;
}

.code .s {
    color: #f8e347;
}

.code .n {
    color: #ffb36b;
}

.sheet {
    display: grid;
    width: 16.2cqw;
    color: #2a3550;
    font: 0.78cqw/1.62 var(--circuit-mono);
}

.sheet b {
    margin-bottom: 0.25cqw;
    color: #0a1a36;
    font: 700 0.95cqw/1.6 var(--circuit-font);
}

.sheet span {
    padding-inline: 0.3cqw;
}

.sheet .removed {
    color: #9e1c22;
    background: #fbd9da;
}

.sheet .added {
    color: #0d5b2f;
    background: #d4f0dc;
}

.apply {
    color: #0a1a36;
    font: 700 1.1cqw/1.3 var(--circuit-font);
}

.board-title {
    color: #ffffff;
    font: 700 0.75cqw/1 var(--circuit-font);
}

.node {
    transform: translate(-50%, -50%);
    color: #ffffff;
    font: 700 0.68cqw/1 var(--circuit-font);
}

.node.changed {
    color: #0a1a36;
    font-size: 0.8cqw;
}

.card-title {
    color: #0a1a36;
    font: 700 0.85cqw/1 var(--circuit-font);
}

.card-name {
    color: #0a1a36;
    font: 700 0.75cqw/1 var(--circuit-mono);
}

.card-date {
    color: #49536a;
    font: 0.62cqw/1 var(--circuit-mono);
}

.commit {
    display: grid;
    justify-items: center;
    gap: 0.15cqw;
    transform: translateX(-50%);
    color: #ffffff;
    font: 600 0.72cqw/1.1 var(--circuit-font);
}

.commit code {
    padding: 0;
    background: none;
    color: var(--circuit-on-cobalt-soft);
    font: 0.62cqw/1 var(--circuit-mono);
}

.commit:last-child,
.commit:last-child code {
    color: var(--circuit-yellow);
}

/* A callout is a link: a numbered dot with a leader line to its place in the drawing. */
.callout {
    position: absolute;
    left: var(--x);
    top: var(--y);
    z-index: 2;
    width: 0;
    height: 0;
    color: var(--circuit-cobalt);
    text-decoration: none;
}

.callout .leader {
    position: absolute;
    left: 0;
    top: -0.12cqw;
    width: var(--length);
    height: 0.24cqw;
    background: #ffffff;
    transform: rotate(var(--angle));
    transform-origin: 0 50%;
}

.callout .leader::after {
    content: "";
    position: absolute;
    right: -0.5cqw;
    top: -0.38cqw;
    width: 1cqw;
    height: 1cqw;
    border-radius: 50%;
    background: #ffffff;
}

.callout .dot {
    position: absolute;
    left: -1.2cqw;
    top: -1.2cqw;
    display: grid;
    place-items: center;
    width: 2.4cqw;
    height: 2.4cqw;
    border-radius: 50%;
    background: #ffffff;
    font: 700 1.1cqw/1 var(--circuit-font);
    transition:
        background-color 0.2s,
        transform 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}

.callout.lit .dot,
.callout:hover .dot,
.callout:focus-visible .dot {
    background: var(--circuit-yellow);
    transform: scale(1.12);
}

/* On arrival the callouts are drawn in, one after another, in the order the legend reads. */
@media (prefers-reduced-motion: no-preference) {
    .callout .leader {
        animation: draw 0.6s cubic-bezier(0.16, 1, 0.3, 1) backwards;
        animation-delay: calc(0.3s + var(--order) * 0.09s);
    }

    .callout .dot {
        animation: pop 0.5s cubic-bezier(0.16, 1, 0.3, 1) backwards;
        animation-delay: calc(0.42s + var(--order) * 0.09s);
    }
}

@keyframes draw {
    from {
        transform: rotate(var(--angle)) scaleX(0);
    }
}

@keyframes pop {
    from {
        opacity: 0;
        transform: scale(0.3);
    }
}

.callout .tag {
    position: absolute;
    left: 1.6cqw;
    top: -1.2cqw;
    z-index: 3;
    width: 15cqw;
    padding: 0.6cqw 0.8cqw;
    border: 0.13cqw solid #0a1a36;
    background: #ffffff;
    color: #11141b;
    font: 0.82cqw/1.4 var(--circuit-font);
    opacity: 0;
    visibility: hidden;
    transform: translateY(0.4cqw);
    transition:
        opacity 0.18s,
        transform 0.18s,
        visibility 0.18s;
}

.callout .tag strong {
    display: block;
    color: var(--circuit-cobalt);
    font-size: 0.95cqw;
}

.callout:nth-of-type(n + 5) .tag {
    left: auto;
    right: 1.6cqw;
}

/* The callout a reader points at rises above every other, so its tag is never covered by a neighbour's dot. */
.callout.lit,
.callout:hover,
.callout:focus-visible {
    z-index: 20;
}

.callout.lit .tag {
    opacity: 1;
    visibility: visible;
    transform: none;
}

/* The legend: the same numbers, named, under a thin rule. */

.legend {
    display: grid;
    grid-template-columns:
        calc(202 * var(--px)) calc(182 * var(--px)) calc(152 * var(--px)) calc(164 * var(--px)) calc(188 * var(--px))
        auto;
    margin: calc(17 * var(--px)) var(--gutter) 0 calc(59 * var(--px));
    padding: calc(16 * var(--px)) 0 0;
    border-top: 1px solid rgba(201, 215, 245, 0.7);
    list-style: none;
}

.legend a {
    display: inline-flex;
    align-items: center;
    gap: calc(22 * var(--px));
    color: #ffffff;
    font-size: max(14px, calc(15.5 * var(--px)));
    font-weight: 600;
    line-height: max(28px, calc(32 * var(--px)));
    text-decoration: none;
}

.legend .dot {
    display: grid;
    place-items: center;
    width: max(22px, calc(28 * var(--px)));
    height: max(22px, calc(28 * var(--px)));
    border-radius: 50%;
    background: #ffffff;
    color: var(--circuit-cobalt);
    font-size: max(12px, calc(14 * var(--px)));
    font-weight: 700;
    transition: background-color 0.2s;
}

.legend a.lit,
.legend a:hover {
    text-decoration: underline dotted 2px;
    text-underline-offset: 6px;
}

.legend a.lit .dot,
.legend a:hover .dot {
    background: var(--circuit-yellow);
    color: #0a1a36;
}

/* The promise and the two ways to start. */

.start {
    display: grid;
    grid-template-columns: calc(650 * var(--px)) calc(262 * var(--px)) calc(480 * var(--px));
    gap: calc(16 * var(--px));
    align-items: center;
    margin: calc(33 * var(--px)) var(--gutter) 0;
}

.lead {
    margin: 0;
    max-width: calc(602 * var(--px));
    font-size: max(19px, calc(29 * var(--px)));
    font-weight: 700;
    line-height: 1.2;
    letter-spacing: -0.01em;
}

.cta,
.command {
    display: flex;
    align-items: center;
    height: max(50px, calc(67 * var(--px)));
}

.cta {
    justify-content: center;
    padding-inline: max(20px, calc(28 * var(--px)));
    white-space: nowrap;
    gap: calc(14 * var(--px));
    border: 2px solid var(--circuit-yellow);
    border-radius: 2px;
    background: var(--circuit-yellow);
    color: #0a1a36;
    font-size: max(17px, calc(24 * var(--px)));
    font-weight: 700;
    text-decoration: none;
    transition: background-color 0.2s;
}

.cta:hover {
    background: #ffffff;
    border-color: #ffffff;
}

.cta svg,
.command svg {
    flex: none;
    width: max(18px, calc(24 * var(--px)));
    height: max(18px, calc(24 * var(--px)));
    fill: none;
    stroke: currentColor;
    stroke-width: 2.4;
    stroke-linecap: round;
    stroke-linejoin: round;
}

.cta:hover svg {
    transform: translateX(3px);
}

.command {
    justify-content: space-between;
    gap: calc(12 * var(--px));
    padding: 0 calc(26 * var(--px));
    border: 2px solid var(--circuit-on-cobalt-soft);
    border-radius: 2px;
    background: rgba(8, 28, 64, 0.35);
    color: #ffffff;
    cursor: copy;
    transition: border-color 0.2s;
}

.command:hover {
    border-color: #ffffff;
}

.command code {
    padding: 0;
    background: none;
    color: inherit;
    font: max(14px, calc(22 * var(--px))) / 1 var(--circuit-mono);
}

.command svg {
    stroke-width: 1.8;
}

.copied {
    margin-left: auto;
    color: var(--circuit-yellow);
    font-size: max(13px, calc(17 * var(--px)));
    font-weight: 700;
}

/* Chapters: a heavy heading on the left with a dotted underline, the reading on the right. */

.chapter {
    display: grid;
    grid-template-columns: calc(644 * var(--px)) minmax(0, calc(720 * var(--px)));
    padding: calc(34 * var(--px)) var(--gutter) calc(120 * var(--px));
    background: var(--circuit-paper);
    color: var(--circuit-ink);
}

.chapter:not(.why) {
    padding-top: calc(100 * var(--px));
}

.chapter h2 {
    align-self: start;
    margin: 0;
    padding: 0 calc(40 * var(--px)) 0 0;
    border: 0;
    font-family: var(--circuit-font);
    font-size: calc(96 * var(--px));
    font-weight: 700;
    line-height: 1.08;
    letter-spacing: -0.04em;
}

/* The dotted line under a heading, as under a word that can be looked up: it follows each line of the heading. */
.chapter h2 span {
    padding-bottom: calc(10 * var(--px));
    background: radial-gradient(circle, var(--circuit-cobalt) 48%, transparent 52%) left bottom / calc(19 * var(--px)) calc(9 * var(--px))
        space no-repeat;
    -webkit-box-decoration-break: clone;
    box-decoration-break: clone;
}

.dark .chapter h2 span {
    background-image: radial-gradient(circle, var(--circuit-link) 48%, transparent 52%);
}

.body {
    padding-top: calc(6 * var(--px));
}

.body p {
    margin: 0 0 calc(18 * var(--px));
    font-size: max(17px, calc(19 * var(--px)));
    line-height: 1.6;
}

.ledger {
    width: 100%;
    margin: calc(6 * var(--px)) 0 calc(24 * var(--px));
    border-collapse: collapse;
    font-size: max(16px, calc(18 * var(--px)));
}

.ledger thead th {
    padding: 0 0 calc(10 * var(--px));
    border-bottom: 2px solid var(--circuit-ink);
    font-size: max(11px, calc(12 * var(--px)));
    font-weight: 700;
    font-stretch: 115%;
    letter-spacing: 0.1em;
    text-align: left;
    text-transform: uppercase;
}

.ledger tbody th,
.ledger td {
    padding: calc(14 * var(--px)) 0;
    border-bottom: 1px solid var(--circuit-line);
    text-align: left;
}

.ledger tbody th {
    width: 42%;
    font-weight: 700;
}

.chapter a,
.close a {
    color: var(--circuit-link);
    font-weight: 600;
    text-decoration: underline dotted 2px;
    text-underline-offset: 5px;
}

.chapter a:hover,
.close a:hover {
    text-decoration-style: solid;
}

/* The same drawn arrow as the opening's button, in the link's colour. */
.onward::after {
    content: "";
    display: inline-block;
    width: 0.9em;
    height: 0.9em;
    margin-left: 0.3em;
    vertical-align: -0.12em;
    background: currentColor;
    -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2.6' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M4 12h15m-6-6 6 6-6 6'/%3E%3C/svg%3E")
        center / contain no-repeat;
    mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2.6' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M4 12h15m-6-6 6 6-6 6'/%3E%3C/svg%3E")
        center / contain no-repeat;
}

.chapter code,
.studio code {
    font-family: var(--circuit-mono);
    font-size: 0.9em;
}

/* How: the four steps, each with what you type for it. */

.how {
    background: var(--circuit-mist);
}

.steps {
    margin: 0 0 calc(28 * var(--px));
    padding: 0;
    list-style: none;
    border-top: 2px solid var(--circuit-ink);
}

.steps li {
    display: grid;
    grid-template-columns: calc(52 * var(--px)) minmax(0, 1fr);
    gap: calc(6 * var(--px)) calc(18 * var(--px));
    padding: calc(22 * var(--px)) 0;
    border-bottom: 1px solid var(--circuit-line);
}

.steps .dot {
    grid-row: span 2;
    display: grid;
    place-items: center;
    width: max(30px, calc(40 * var(--px)));
    height: max(30px, calc(40 * var(--px)));
    border-radius: 50%;
    background: var(--circuit-cobalt);
    color: #ffffff;
    font-size: max(15px, calc(19 * var(--px)));
    font-weight: 700;
}

.steps p {
    margin: 0;
}

.steps strong {
    font-weight: 700;
}

.steps code {
    justify-self: start;
    padding: 4px 10px;
    border-radius: 2px;
    background: var(--circuit-navy);
    color: #e6ecfa;
    font-size: max(13px, calc(15 * var(--px)));
}

.steps code::before {
    content: "$ ";
    color: var(--circuit-yellow);
}

.steps code.file::before {
    content: none;
}

.dark .steps code {
    background: #050a16;
    box-shadow: inset 0 0 0 1px var(--circuit-line);
}

/* Where to begin: the three patterns as a parts list, each with the files it starts with. */

.patterns {
    margin: calc(10 * var(--px)) 0 0;
    padding: 0;
    list-style: none;
    border-top: 2px solid var(--circuit-ink);
}

.patterns > li {
    padding: calc(22 * var(--px)) 0;
    border-bottom: 1px solid var(--circuit-line);
}

.patterns > li > a {
    font-size: max(21px, calc(28 * var(--px)));
    font-weight: 700;
    letter-spacing: -0.015em;
    text-decoration-thickness: 2px;
}

.patterns > li > p {
    margin: calc(6 * var(--px)) 0 calc(12 * var(--px));
}

.files {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
}

.files li {
    padding: 2px 8px;
    border: 1px solid var(--circuit-line);
    border-radius: 2px;
    color: var(--circuit-soft);
    font: max(12px, calc(13.5 * var(--px))) / 1.5 var(--circuit-mono);
}

/* Studio: a cobalt chapter with the real screen in it. */

.studio {
    display: grid;
    grid-template-columns: calc(500 * var(--px)) minmax(0, 1fr);
    gap: calc(64 * var(--px));
    align-items: center;
    padding: calc(110 * var(--px)) 0 calc(110 * var(--px)) var(--gutter);
    overflow: hidden;
    background: var(--circuit-cobalt);
    color: #ffffff;
}

.studio h2 {
    margin: 0 0 calc(24 * var(--px));
    padding: 0;
    border: 0;
    font-size: calc(72 * var(--px));
    font-weight: 700;
    line-height: 0.98;
    letter-spacing: -0.035em;
}

.studio p {
    margin: 0 0 calc(24 * var(--px));
    color: #e3ebfb;
    font-size: max(17px, calc(19 * var(--px)));
    line-height: 1.6;
}

.studio code {
    padding: 1px 6px;
    border-radius: 2px;
    background: rgba(8, 28, 64, 0.45);
    color: #ffffff;
}

.studio .onward {
    color: var(--circuit-yellow);
    font-size: max(17px, calc(19 * var(--px)));
    font-weight: 700;
    text-decoration: underline dotted 2px;
    text-underline-offset: 6px;
}

.shot {
    display: block;
    width: 100%;
    height: auto;
    border: 2px solid #0a1a36;
    border-right: 0;
}

/* What it runs on: the proved models as a data plate, then the caution. */

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

/* The close: one yellow field to start from. */

.close {
    padding: calc(110 * var(--px)) var(--gutter) calc(120 * var(--px));
    background: var(--circuit-yellow);
    color: #0a1a36;
}

.close h2 {
    max-width: calc(980 * var(--px));
    margin: 0 0 calc(20 * var(--px));
    padding: 0;
    border: 0;
    font-size: calc(96 * var(--px));
    font-weight: 700;
    line-height: 0.95;
    letter-spacing: -0.04em;
}

.close > p {
    max-width: 60ch;
    margin: 0 0 calc(32 * var(--px));
    font-size: max(17px, calc(20 * var(--px)));
    line-height: 1.55;
}

.close a {
    color: #0a1a36;
}

.starter {
    display: flex;
    flex-wrap: wrap;
    align-items: stretch;
    gap: 10px;
    margin-bottom: calc(28 * var(--px));
}

.managers {
    display: flex;
    border: 2px solid #0a1a36;
    border-radius: 2px;
}

.managers button {
    padding: 0 max(14px, calc(20 * var(--px)));
    color: #0a1a36;
    font-size: max(15px, calc(17 * var(--px)));
    font-weight: 700;
}

.managers button + button {
    border-left: 2px solid #0a1a36;
}

.managers button[aria-selected="true"] {
    background: #0a1a36;
    color: var(--circuit-yellow);
}

.close .command {
    min-width: min(100%, calc(560 * var(--px)));
    height: auto;
    min-height: 56px;
    border-color: #0a1a36;
    background: #0a1a36;
}

.close .command code {
    font-size: max(16px, calc(20 * var(--px)));
}

.close .more {
    margin: 0;
    font-size: max(16px, calc(18 * var(--px)));
}

/* Narrow windows: the opening stacks, and the drawing keeps its scale and scrolls sideways in its own frame. */
@media (max-width: 1100px) {
    .start {
        grid-template-columns: minmax(0, 1fr) auto auto;
    }

    .legend {
        grid-template-columns: repeat(3, auto);
        justify-content: start;
        column-gap: 40px;
    }
}

@media (max-width: 760px) {
    .home {
        --gutter: 16px;
    }

    .hero {
        padding: 28px 0 36px;
    }

    h1 {
        font-size: clamp(44px, 13.6vw, 72px);
        line-height: 0.92;
        white-space: normal;
    }

    .plate {
        margin-top: 12px;
        overflow-x: auto;
        overscroll-behavior-x: contain;
        scrollbar-color: rgba(255, 255, 255, 0.5) transparent;
    }

    .stage {
        width: 900px;
    }

    .swipe {
        position: sticky;
        left: 0;
        display: block;
        width: max-content;
        margin: 4px var(--gutter) 0;
        color: var(--circuit-on-cobalt-soft);
        font-size: 14px;
        font-weight: 600;
    }

    .legend {
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 6px 16px;
        margin: 16px var(--gutter) 0;
        padding-top: 16px;
    }

    .start {
        grid-template-columns: minmax(0, 1fr);
        gap: 12px;
        margin-top: 28px;
    }

    .lead {
        max-width: none;
        font-size: 22px;
    }

    .command {
        padding-inline: 16px;
    }

    .chapter,
    .studio {
        grid-template-columns: minmax(0, 1fr);
        gap: 28px;
        padding: 64px var(--gutter) 72px;
    }

    .chapter.why {
        padding-top: 48px;
    }

    .chapter h2 {
        font-size: 52px;
    }

    .chapter h2 span {
        padding-bottom: 8px;
        background-size: 14px 7px;
    }

    .steps li {
        grid-template-columns: 40px minmax(0, 1fr);
        padding: 18px 0;
    }

    .steps code {
        max-width: 100%;
        overflow-x: auto;
    }

    .studio h2 {
        font-size: 44px;
    }

    .shot {
        border-right: 2px solid #0a1a36;
    }

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

    .close {
        padding: 64px var(--gutter) 72px;
    }

    .close h2 {
        font-size: 46px;
    }

    .starter,
    .managers {
        width: 100%;
    }

    .managers button {
        flex: 1;
        min-height: 44px;
    }

    .close .command code {
        font-size: 14px;
    }
}

.visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
}
</style>
