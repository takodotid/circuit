// The lessons a reader has finished and the entry checks they passed, kept in their own browser. Nothing leaves it.

import { ref } from "vue";
import { Academy } from "../../academy";

export class Progress {
    private static readonly KEY = "circuit-academy-done";

    /** Where passed entry checks are kept. The page's head reads it too, before the page is drawn: see LOCK_SCRIPT. */
    static readonly CHECKS_KEY = "circuit-academy-checks";

    /** Each finished lesson's address, with the time it was finished. */
    static readonly done = ref<Record<string, number>>({});

    /** Each level whose entry check was passed, with the time it was passed. */
    static readonly passed = ref<Record<string, number>>({});

    /** The levels behind an entry check: every level after the first. */
    static readonly GATED = Academy.LEVELS.slice(1).map((level) => level.slug);

    /**
     * Run in the page's head before anything is drawn, so a closed level's lesson never shows for a moment before its gate.
     * It repeats isOpen() in plain JavaScript.
     */
    static readonly LOCK_SCRIPT = `(function () {
    try {
        var gated = ${JSON.stringify(Progress.GATED)};
        var match = location.pathname.match(new RegExp("^/academy/([a-z-]+)/"));
        var needed = match ? gated.indexOf(match[1]) : -1;
        if (needed < 0) return;
        var checks = JSON.parse(localStorage.getItem("${Progress.CHECKS_KEY}") || "{}");
        if (!gated.slice(needed).some(function (level) { return checks[level]; })) document.documentElement.classList.add("academy-locked");
    } catch (error) {}
})();`;

    private static loaded = false;

    /**
     * Whether a level is open in this browser. The first is always open; a later one opens with its own entry check, or a check for a
     * level after it, since that check asks about this level too.
     */
    static isOpen(slug: string, checks: Record<string, number> = Progress.passed.value) {
        const needed = Progress.GATED.indexOf(slug);
        return needed < 0 || Progress.GATED.slice(needed).some((level) => Boolean(checks[level]));
    }

    /** Read what this browser remembers, once, after the page is in the browser. */
    static load() {
        if (Progress.loaded || typeof window === "undefined") return;
        Progress.loaded = true;

        Progress.done.value = Progress.read(Progress.KEY);
        Progress.passed.value = Progress.read(Progress.CHECKS_KEY);

        // Another tab finishing a lesson or passing a check shows here too.
        window.addEventListener("storage", (event) => {
            if (event.key === Progress.KEY) Progress.done.value = Progress.read(Progress.KEY);
            if (event.key === Progress.CHECKS_KEY) Progress.passed.value = Progress.read(Progress.CHECKS_KEY);
        });
    }

    /** What this browser keeps under a key, or nothing when storage is blocked or holds something else. */
    private static read(key: string): Record<string, number> {
        try {
            const saved = JSON.parse(localStorage.getItem(key) ?? "{}");
            return saved && typeof saved === "object" ? saved : {};
        } catch {
            return {};
        }
    }

    private static write(key: string, value: Record<string, number>) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
        } catch {
            // The mark still holds until the page is closed.
        }
    }

    private static save() {
        Progress.write(Progress.KEY, Progress.done.value);
    }

    static setPassed(slug: string) {
        Progress.passed.value = { ...Progress.passed.value, [slug]: Date.now() };
        Progress.write(Progress.CHECKS_KEY, Progress.passed.value);
    }

    /** A lesson's address without a trailing `.html` or slash, as the sidebar and the curriculum write it. */
    static normalize(path: string) {
        return path.replace(/\.html$/, "").replace(/\/index$/, "/");
    }

    static isDone(link: string) {
        return Boolean(Progress.done.value[Progress.normalize(link)]);
    }

    static setDone(link: string, finished: boolean) {
        const next = { ...Progress.done.value };

        if (finished) next[Progress.normalize(link)] = Date.now();
        else delete next[Progress.normalize(link)];

        Progress.done.value = next;
        Progress.save();
    }

    static reset() {
        Progress.done.value = {};
        Progress.passed.value = {};
        Progress.save();
        Progress.write(Progress.CHECKS_KEY, Progress.passed.value);
    }
}
