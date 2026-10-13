// The lessons a reader has finished, kept in their own browser. Nothing leaves it, and a browser that refuses storage still shows every lesson.

import { ref } from "vue";

const KEY = "circuit-academy-done";

/** Each finished lesson's address, with the time it was finished. */
export const done = ref<Record<string, number>>({});

let loaded = false;

/** Read what this browser remembers, once, after the page is in the browser. */
export function loadProgress() {
    if (loaded || typeof window === "undefined") return;
    loaded = true;

    try {
        const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}");
        if (saved && typeof saved === "object") done.value = saved;
    } catch {
        // Storage is blocked or holds something else: start with nothing finished.
    }

    // Another tab finishing a lesson shows here too.
    window.addEventListener("storage", (event) => {
        if (event.key !== KEY) return;

        try {
            done.value = JSON.parse(event.newValue ?? "{}");
        } catch {
            done.value = {};
        }
    });
}

function save() {
    try {
        localStorage.setItem(KEY, JSON.stringify(done.value));
    } catch {
        // The mark still holds until the page is closed.
    }
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
    save();
}
