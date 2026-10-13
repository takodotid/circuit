// The lessons a reader has finished and the entry checks they passed, kept in their own browser. Nothing leaves it.

import { ref } from "vue";
import { levels } from "../../academy";

const KEY = "circuit-academy-done";

/** Where passed entry checks are kept. The page's head reads it too, before the page is drawn: see LOCK_SCRIPT. */
export const CHECKS_KEY = "circuit-academy-checks";

/** Each finished lesson's address, with the time it was finished. */
export const done = ref<Record<string, number>>({});

/** Each level whose entry check was passed, with the time it was passed. */
export const passed = ref<Record<string, number>>({});

/** The levels behind an entry check: every level after the first. */
export const gated = levels.slice(1).map((level) => level.slug);

/**
 * Whether a level is open in this browser. The first is always open; a later one opens with its own entry check, or a check for a
 * level after it, since that check asks about this level too.
 */
export function isOpen(slug: string, checks: Record<string, number> = passed.value) {
    const needed = gated.indexOf(slug);
    return needed < 0 || gated.slice(needed).some((level) => Boolean(checks[level]));
}

/**
 * Run in the page's head before anything is drawn, so a closed level's lesson never shows for a moment before its gate.
 * It repeats isOpen() in plain JavaScript.
 */
export const LOCK_SCRIPT = `(function () {
    try {
        var gated = ${JSON.stringify(gated)};
        var match = location.pathname.match(new RegExp("^/academy/([a-z-]+)/"));
        var needed = match ? gated.indexOf(match[1]) : -1;
        if (needed < 0) return;
        var checks = JSON.parse(localStorage.getItem("${CHECKS_KEY}") || "{}");
        if (!gated.slice(needed).some(function (level) { return checks[level]; })) document.documentElement.classList.add("academy-locked");
    } catch (error) {}
})();`;

let loaded = false;

/** Read what this browser remembers, once, after the page is in the browser. */
export function loadProgress() {
    if (loaded || typeof window === "undefined") return;
    loaded = true;

    done.value = read(KEY);
    passed.value = read(CHECKS_KEY);

    // Another tab finishing a lesson or passing a check shows here too.
    window.addEventListener("storage", (event) => {
        if (event.key === KEY) done.value = read(KEY);
        if (event.key === CHECKS_KEY) passed.value = read(CHECKS_KEY);
    });
}

/** What this browser keeps under a key, or nothing when storage is blocked or holds something else. */
function read(key: string): Record<string, number> {
    try {
        const saved = JSON.parse(localStorage.getItem(key) ?? "{}");
        return saved && typeof saved === "object" ? saved : {};
    } catch {
        return {};
    }
}

function write(key: string, value: Record<string, number>) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch {
        // The mark still holds until the page is closed.
    }
}

function save() {
    write(KEY, done.value);
}

export function setPassed(slug: string) {
    passed.value = { ...passed.value, [slug]: Date.now() };
    write(CHECKS_KEY, passed.value);
}

/** A lesson's address without a trailing `.html` or slash, as the sidebar and the curriculum write it. */
export const normalize = (path: string) => path.replace(/\.html$/, "").replace(/\/index$/, "/");

export function isDone(link: string) {
    return Boolean(done.value[normalize(link)]);
}

export function setDone(link: string, finished: boolean) {
    const next = { ...done.value };

    if (finished) next[normalize(link)] = Date.now();
    else delete next[normalize(link)];

    done.value = next;
    save();
}

export function resetProgress() {
    done.value = {};
    passed.value = {};
    save();
    write(CHECKS_KEY, passed.value);
}
