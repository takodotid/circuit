// What the page knows: what the server gathered last, where the reader is, and whether the server is still there. The server tells the page when the project changed, and the page reads it again.

import { reactive } from "vue";
import type { StudioData } from "../../../types";

export type Route = { view: string; parts: string[] };

function parseRoute(): Route {
    const parts = location.hash.slice(1).split("/").map(decodeURIComponent).filter(Boolean);
    return { view: parts[0] ?? "graph", parts: parts.slice(1) };
}

export const store = reactive({
    data: undefined as StudioData | undefined,
    /** What stopped the server reading the project, shown over the page. */
    error: "",
    live: "connecting" as "connecting" | "live" | "offline",
    /** The project was read again just now. */
    beat: false,
    route: parseRoute(),
});

/** Go to a place in the page, such as `devices/edge-01/ports`. */
export function go(path: string): void {
    location.hash = path
        .split("/")
        .map((part) => encodeURIComponent(part))
        .join("/");
}

/**
 * What a tool keeps in the address after its place, such as `device=edge-01&chain=input` after `#tools/firewall/`, so a test can be
 * bookmarked or sent. Read again each time the address changes.
 */
export function placeParams(place: string): URLSearchParams {
    void store.route;
    const hash = location.hash.slice(1);
    return new URLSearchParams(hash.startsWith(`${place}/`) ? hash.slice(place.length + 1) : "");
}

/** Go to a tool's place with what it keeps in the address. */
export function goParams(place: string, params: URLSearchParams): void {
    location.hash = `${place}/${params}`;
}

addEventListener("hashchange", () => {
    store.route = parseRoute();
});

/** A request to the server. A request that reaches a device takes Studio's header and a POST. */
export async function api<T>(path: string, reachesDevice = false): Promise<T> {
    const response = await fetch(path, reachesDevice ? { method: "POST", headers: { "x-circuit-studio": "1" } } : {});
    if (!response.ok) throw new Error(`the server answered ${response.status}`);

    const body = (await response.json()) as T | { error: string };
    if (body && typeof body === "object" && "error" in body && typeof body.error === "string") throw new Error(body.error);
    return body as T;
}

async function load(): Promise<void> {
    try {
        const body = (await (await fetch("/api/data")).json()) as StudioData | { error: string };
        if ("error" in body) {
            store.error = body.error;
            return;
        }
        store.data = body;
        store.error = "";
    } catch (error) {
        store.error = (error as Error).message;
    }
}

/** Read what the server gathered, and again each time it says the project changed. */
export function connect(): void {
    void load();

    const events = new EventSource("/api/events");
    events.onopen = () => (store.live = "live");
    events.onerror = () => (store.live = "offline");
    events.onmessage = async () => {
        await load();
        store.beat = true;
        setTimeout(() => (store.beat = false), 1200);
    };
}
