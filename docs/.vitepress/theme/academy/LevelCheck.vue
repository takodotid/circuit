<script setup lang="ts">
// A level's entry check: a few questions drawn from the level before it, with their answers in a new order each time. Passing opens the level in this browser.

import { computed, onMounted, ref } from "vue";
import { withBase } from "vitepress";
import { Academy } from "../../academy";
import { checks, type Question } from "./checks";
import { Progress } from "./progress";

const props = defineProps<{ level: string }>();

const check = checks.find((entry) => entry.level === props.level)!;
const level = Academy.LEVELS.find((entry) => entry.slug === check.level)!;
const about = Academy.LEVELS.find((entry) => entry.slug === check.about)!;
const lessonTitle = (link: string) => about.lessons.find((lesson) => Academy.link(about, lesson) === link)?.title ?? link;

type Drawn = Question & { order: number[] };

/** The questions of this try, each with its choices in the order shown. Drawn in the browser, so every try differs. */
const drawn = ref<Drawn[]>([]);
const picked = ref<Record<number, number>>({});
const submitted = ref(false);
const ready = ref(false);

function shuffled<T>(items: T[]): T[] {
    const copy = [...items];
    for (let index = copy.length - 1; index > 0; index--) {
        const other = Math.floor(Math.random() * (index + 1));
        [copy[index], copy[other]] = [copy[other]!, copy[index]!];
    }
    return copy;
}

function draw() {
    drawn.value = shuffled(check.questions)
        .slice(0, check.asks)
        .map((question) => ({ ...question, order: shuffled(question.choices.map((_, index) => index)) }));
    picked.value = {};
    submitted.value = false;
}

onMounted(() => {
    Progress.load();
    draw();
    ready.value = true;
});

const answered = computed(() => Object.keys(picked.value).length);
const right = computed(() => drawn.value.filter((question, index) => picked.value[index] === question.answer).length);
const passedNow = computed(() => submitted.value && right.value >= check.pass);
const passedBefore = computed(() => Progress.passed.value[check.level]);

/** The lessons to read again: the ones behind every question answered wrong. */
const review = computed(() => [
    ...new Set(drawn.value.filter((question, index) => picked.value[index] !== question.answer).map((question) => question.lesson)),
]);

function submit() {
    submitted.value = true;
    if (right.value >= check.pass) Progress.setPassed(check.level);
}

const first = Academy.link(level, level.lessons[0]!);
const day = (time: number) => new Date(time).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
</script>

<template>
    <div class="level-check">
        <p v-if="!ready" class="ac-say hint">Drawing the questions…</p>

        <template v-else>
            <aside v-if="passedBefore && !submitted" class="open">
                <p class="chip">Open</p>
                <p>
                    You passed this check on {{ day(passedBefore) }}, so {{ level.name }} is open in this browser.
                    <a :href="withBase(first)">Go to its first lesson</a>, or take the check again below.
                </p>
            </aside>

            <p class="rule">
                {{ check.asks }} questions about {{ about.name }}. Answer at least {{ check.pass }} right to open {{ level.name }}. Each try
                asks different questions, with the answers in a new order.
            </p>

            <ol class="questions">
                <li
                    v-for="(question, index) in drawn"
                    :key="question.question"
                    :class="{ wrong: submitted && picked[index] !== question.answer }"
                >
                    <fieldset :disabled="submitted">
                        <legend>{{ question.question }}</legend>
                        <label v-for="choice in question.order" :key="choice" class="choice" :class="{ on: picked[index] === choice }">
                            <input v-model="picked[index]" type="radio" :name="`q${index}`" :value="choice" />
                            <span>{{ question.choices[choice] }}</span>
                        </label>
                        <p v-if="submitted && picked[index] !== question.answer" class="missed">
                            Not this one. Read <a :href="withBase(question.lesson)">{{ lessonTitle(question.lesson) }}</a> again.
                        </p>
                    </fieldset>
                </li>
            </ol>

            <div class="actions">
                <button v-if="!submitted" type="button" class="ac-button primary" :disabled="answered < drawn.length" @click="submit">
                    {{ answered < drawn.length ? `Answer every question (${answered} of ${drawn.length})` : "Check my answers" }}
                </button>
                <button v-else type="button" class="ac-button" @click="draw">Try again with new questions</button>
            </div>

            <div aria-live="polite">
                <template v-if="submitted">
                    <p v-if="passedNow" class="ac-say good" data-word="Passed">
                        {{ right }} of {{ drawn.length }} right. {{ level.name }} is open in this browser.
                        <a :href="withBase(first)">Start its first lesson</a>.
                    </p>
                    <div v-else>
                        <p class="ac-say bad" data-word="Not yet">
                            {{ right }} of {{ drawn.length }} right; {{ level.name }} opens at {{ check.pass }}. The questions marked above
                            say which lesson to read again:
                        </p>
                        <ul class="review">
                            <li v-for="link in review" :key="link">
                                <a :href="withBase(link)">{{ lessonTitle(link) }}</a>
                            </li>
                        </ul>
                    </div>
                </template>
            </div>
        </template>
    </div>
</template>

<style scoped>
.rule {
    color: var(--circuit-soft);
}

.questions {
    display: grid;
    gap: 14px;
    margin: 20px 0 !important;
    padding: 0 !important;
    list-style: none;
    counter-reset: question;
}

.questions > li {
    margin: 0 !important;
    padding: 16px 18px 12px;
    border: 2px solid var(--circuit-ink);
    counter-increment: question;
}

.questions > li.wrong {
    border-color: var(--circuit-removed);
    border-style: dashed;
}

fieldset {
    min-width: 0;
    margin: 0;
    padding: 0;
    border: 0;
}

legend {
    display: block;
    margin-bottom: 10px;
    font-size: 17px;
    font-weight: 700;
    line-height: 1.45;
    overflow-wrap: anywhere;
}

legend::before {
    content: counter(question) ". ";
    color: var(--circuit-soft);
}

.choice {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    min-height: 40px;
    margin-top: 6px;
    padding: 8px 12px;
    border: 1.5px solid var(--circuit-line);
    border-radius: 2px;
    cursor: pointer;
    font-size: 15.5px;
    line-height: 1.45;
    overflow-wrap: anywhere;
}

.choice.on {
    border-color: var(--circuit-cobalt);
    background: color-mix(in srgb, var(--circuit-cobalt) 8%, var(--circuit-paper));
}

.choice input {
    flex: none;
    margin-top: 4px;
    accent-color: var(--circuit-cobalt);
}

fieldset:disabled .choice {
    cursor: default;
}

.missed {
    margin: 10px 0 0 !important;
    color: var(--circuit-removed);
    font-size: 15px;
}

.missed a {
    color: inherit;
}

.actions {
    margin-bottom: 4px;
}

.actions .ac-button {
    white-space: normal;
}

.review {
    margin-top: 8px !important;
}

.open {
    margin: 20px 0;
    padding: 16px 20px 6px;
    border: 2px solid var(--circuit-added);
}

.chip {
    display: inline-block;
    margin: 0 0 6px !important;
    padding: 2px 8px;
    background: var(--circuit-added);
    color: #ffffff;
    font-size: 12px !important;
    font-weight: 700;
    font-stretch: 120%;
    letter-spacing: 0.1em;
    line-height: 20px !important;
    text-transform: uppercase;
}

.dark .chip {
    color: #0b1122;
}

.hint {
    color: var(--circuit-soft);
}
</style>
