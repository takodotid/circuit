<script setup lang="ts">
// The opening: the title, the drawing of a change travelling from the file to the network, its legend, and the two ways to start.

import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { withBase } from "vitepress";
import { useCopy } from "./copy";
import { HomeContent } from "./home-content";
import { HomeDrawing } from "./home-drawing";

const { copied, copy } = useCopy();
const { on, box, tokens, planLine } = HomeDrawing;

const install = HomeContent.INSTALL;
const arts = HomeDrawing.ARTS;
const parts = HomeDrawing.PARTS;
const nodes = HomeDrawing.NODES;
const changes = HomeDrawing.CHANGES;

// The part a visitor points at, by number: its callout and its legend entry light up together.
const active = ref(0);

const stage = ref<HTMLElement>();
const windowStyle = ref<Record<string, string>>({ visibility: "hidden" });

/** Bend the editor's words onto the drawing at the width the drawing has now. */
function fitWindow() {
    if (!stage.value) return;

    windowStyle.value = HomeDrawing.editorStyle(stage.value.clientWidth);
}

let watcher: ResizeObserver | undefined;

const hero = ref<HTMLElement>();

// The opening's looping marks rest while it is out of sight.
const idle = ref(false);
let sight: IntersectionObserver | undefined;

onMounted(() => {
    fitWindow();
    watcher = new ResizeObserver(fitWindow);
    if (stage.value) watcher.observe(stage.value);

    sight = new IntersectionObserver(([entry]) => (idle.value = !entry?.isIntersecting));
    if (hero.value) sight.observe(hero.value);

    // A new change is written every few seconds, as if the network were being worked on. Reduced motion keeps the first.
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches) cycle = setInterval(nextChange, 7500);
});

onBeforeUnmount(() => {
    watcher?.disconnect();
    sight?.disconnect();
    clearInterval(cycle);
});

// The change shown now, and whether the drawing has moved on from the first, so its parts come in without the opening's delays.
const step = ref(0);
const again = ref(false);
const change = computed(() => changes[step.value % changes.length]!);

// The git history under the drawing: each change shown is committed, and the oldest commit moves out of view.
const history = ref([...HomeDrawing.HISTORY]);

const commits = computed(() => history.value.map((commit, index) => ({ ...commit, x: HomeDrawing.STATIONS[index]! })));

let cycle: ReturnType<typeof setInterval> | undefined;

/** Move on to the next change, unless the opening is out of sight or the page is hidden. */
function nextChange() {
    if (idle.value || document.hidden) return;

    step.value += 1;
    again.value = true;
    history.value = [...history.value.slice(1), change.value.commit];
}
</script>

<template>
    <header ref="hero" class="hero" :class="{ idle }">
        <h1><span class="written">Your network, written down.</span></h1>

        <figure class="plate" aria-labelledby="plate-caption">
            <div ref="stage" class="stage" @mouseleave="active = 0">
                <img
                    v-for="(art, index) in arts"
                    :key="art.plate"
                    class="art"
                    :style="{ ...box(art.plate), '--i': index }"
                    :src="withBase(art.src)"
                    alt=""
                    width="1152"
                    height="768"
                    :fetchpriority="index === 0 ? 'high' : undefined"
                />

                <div class="set" aria-hidden="true">
                    <div class="window" :class="{ again }" :style="windowStyle">
                        <span class="tab">edge-b1.ts</span>
                        <pre
                            :key="step"
                            class="code"
                            :style="{ '--lines': change.code.length }"
                        ><template v-for="(line, row) in change.code" :key="row"><span v-for="(part, index) in tokens(line)" :key="index" :class="part.kind">{{ part.text }}</span>{{ row < change.code.length - 1 ? "\n" : "" }}</template><span class="caret" /></pre>
                    </div>

                    <div
                        :key="step"
                        class="sheet"
                        :class="{ again }"
                        :style="{ ...on('plan', 306, 108), '--lines': change.lines.length + 1 }"
                    >
                        <b>{{ change.plan }}</b>
                        <span v-for="(line, row) in change.lines.map(planLine)" :key="row" :class="line.kind">{{ line.text }}</span>
                    </div>

                    <span :key="step" class="apply" :class="{ again }" :style="on('plan', 1300, 282)">Apply</span>

                    <span class="board-title" :style="on('network', 349, 112)">Network</span>
                    <span class="ping" :style="on('network', 455, 408)" />
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

                    <span
                        v-for="(commit, index) in commits"
                        :key="commit.hash"
                        class="commit"
                        :class="{ again }"
                        :style="{ ...on('network', commit.x, 772), '--i': index }"
                    >
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
            <li v-for="part in parts" :key="part.number" :style="{ '--i': part.number - 1 }">
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
</template>

<style scoped>
.hero :focus-visible {
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

.written {
    display: inline-block;
}

/* The caret the title is written with: it blinks a few times once the line is down, then leaves. */
.written::after {
    content: "";
    display: inline-block;
    width: 0.07em;
    height: 0.78em;
    margin-left: 0.05em;
    vertical-align: -0.04em;
    background: var(--circuit-yellow);
    opacity: 0;
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

/* The editor's caret, still blinking after the file is written. */
.caret {
    display: inline-block;
    width: 14px;
    height: 34px;
    margin-left: 6px;
    vertical-align: -7px;
    background: var(--circuit-yellow);
}

/* The changed device keeps sending out a ring, the way the network drawing marks what a plan would touch. */
.ping {
    width: 5.2cqw;
    height: 2.8cqw;
    margin: -1.4cqw 0 0 -2.6cqw;
    border: 0.2cqw solid #ffffff;
    border-radius: 50%;
    opacity: 0;
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

.sheet .changed {
    color: #0a1a36;
    background: #fff7c2;
}

/* A commit moves along the history as newer ones arrive. */
.commit {
    transition: left 0.6s var(--ease);
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
        animation: draw 0.6s var(--ease) backwards;
        animation-delay: calc(1.25s + var(--order) * 0.09s);
    }

    .callout .dot {
        animation: home-pop 0.5s var(--ease) backwards;
        animation-delay: calc(1.37s + var(--order) * 0.09s);
    }
}

@keyframes draw {
    from {
        transform: rotate(var(--angle)) scaleX(0);
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

/* The promise and the two ways to start. The command's own look is in home.css, shared with the close. */

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

.cta {
    display: flex;
    align-items: center;
    height: max(50px, calc(67 * var(--px)));
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

.cta svg {
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

/* The opening is written as the visitor arrives: the title line, then the change travelling through the drawing, left to right. */
@media (prefers-reduced-motion: no-preference) {
    .written {
        animation: write 0.9s cubic-bezier(0.65, 0, 0.35, 1) 0.1s backwards;
    }

    .written::after {
        animation: blink 1s steps(1) 0.95s 3;
    }

    .art {
        animation: home-rise 0.8s var(--ease) backwards;
        animation-delay: calc(0.3s + var(--i) * 0.16s);
    }

    .window {
        animation: home-fade 0.5s var(--ease) 0.45s backwards;
    }

    .code {
        animation: type calc(var(--lines) * 0.09s) steps(var(--lines), end) 0.55s backwards;
    }

    .sheet {
        animation: type calc(var(--lines) * 0.09s) steps(var(--lines), end) 0.85s backwards;
    }

    /* Each change after the first: the code is written, the plan printed from it, Apply pressed, and the commit lands. */
    .again .code {
        animation-delay: 0.1s;
    }

    .sheet.again {
        animation-delay: 1.4s;
    }

    .apply.again {
        animation: press 0.5s var(--ease) 2.4s;
    }

    .commit.again:last-child {
        animation: home-rise 0.6s var(--ease) 2.8s backwards;
    }

    .apply,
    .board-title,
    .node,
    .card-title,
    .card-name,
    .card-date {
        animation: home-fade 0.5s var(--ease) 1s backwards;
    }

    .commit {
        animation: home-fade 0.45s var(--ease) backwards;
        animation-delay: calc(1.05s + var(--i) * 0.1s);
    }

    .caret {
        animation: blink 1.1s steps(1) 1.7s infinite;
    }

    .ping {
        animation: ping 2.6s var(--ease) 1.5s infinite;
    }

    .legend li {
        animation: home-rise 0.6s var(--ease) backwards;
        animation-delay: calc(1.3s + var(--i) * 0.09s);
    }

    .start > * {
        animation: home-rise 0.7s var(--ease) backwards;
    }

    .start > :nth-child(2) {
        animation-delay: 0.12s;
    }

    .start > :nth-child(3) {
        animation-delay: 0.2s;
    }

    .idle .caret,
    .idle .ping {
        animation-play-state: paused;
    }
}

@keyframes press {
    40% {
        transform: scale(0.88);
    }
}

@keyframes write {
    from {
        clip-path: inset(-10% 100% -25% 0);
    }

    to {
        clip-path: inset(-10% -5% -25% 0);
    }
}

@keyframes blink {
    0%,
    49% {
        opacity: 1;
    }

    50%,
    100% {
        opacity: 0;
    }
}

@keyframes type {
    from {
        clip-path: inset(0 0 100% 0);
    }

    to {
        clip-path: inset(0 0 0 0);
    }
}

@keyframes ping {
    from {
        opacity: 0.95;
        transform: scale(0.6);
    }

    to {
        opacity: 0;
        transform: scale(1.6);
    }
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
