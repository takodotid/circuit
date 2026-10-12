// @ts-check
/// <reference lib="dom" />
// Small helpers every part of studio's page uses: making elements, links that act, and browser storage that may be missing.

const SVG = "http://www.w3.org/2000/svg";

/** @typedef {Node | string | undefined | false} Child */

/**
 * An element with attributes and children. Text is always set as text, never parsed as HTML.
 *
 * @template {keyof HTMLElementTagNameMap} K
 * @param {K} tag
 * @param {Record<string, string>} [attributes]
 * @param {...Child} children
 * @returns {HTMLElementTagNameMap[K]}
 */
export function h(tag, attributes = {}, ...children) {
    const element = document.createElement(tag);
    for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
    for (const child of children) if (child !== undefined && child !== false) element.append(child);
    return element;
}

/**
 * An SVG element with attributes.
 *
 * @template {keyof SVGElementTagNameMap} K
 * @param {K} tag
 * @param {Record<string, string | number>} [attributes]
 * @returns {SVGElementTagNameMap[K]}
 */
export function s(tag, attributes = {}) {
    const element = document.createElementNS(SVG, tag);
    for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, String(value));
    return element;
}

/**
 * A link that runs an action, by mouse or keyboard.
 *
 * @param {string} text
 * @param {() => void} action
 */
export function link(text, action) {
    const anchor = h("a", { role: "button", tabindex: "0" }, text);
    anchor.addEventListener("click", action);
    anchor.addEventListener("keydown", (event) => event.key === "Enter" && action());
    return anchor;
}

/**
 * The element with this id, which index.html always has.
 *
 * @param {string} id
 */
export function byId(id) {
    const element = document.getElementById(id);
    if (!(element instanceof HTMLElement)) throw new Error(`index.html has no element ${id}`);
    return element;
}

/**
 * The SVG element with this id, which index.html always has.
 *
 * @param {string} id
 */
export function svgById(id) {
    const element = document.getElementById(id);
    if (!(element instanceof SVGElement)) throw new Error(`index.html has no SVG element ${id}`);
    return element;
}

/** Browser storage can be missing or refuse, in a private window for example. The page works without it. */
export const store = {
    /**
     * @template T
     * @param {string} key
     * @returns {T | undefined}
     */
    get(key) {
        try {
            const value = localStorage.getItem(`circuit-studio:${key}`);
            return value === null ? undefined : /** @type {T} */ (JSON.parse(value));
        } catch {
            return undefined;
        }
    },

    /**
     * @param {string} key
     * @param {unknown} value
     */
    set(key, value) {
        try {
            localStorage.setItem(`circuit-studio:${key}`, JSON.stringify(value));
        } catch {}
    },
};

/**
 * Go to a place in studio, such as `graph/bgp` or `devices/edge-01/ports`. The place is the address's fragment, so the back button and a bookmark work.
 *
 * @param {string} route
 */
export function go(route) {
    location.hash = route;
}
