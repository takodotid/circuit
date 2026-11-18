// What the page knows: what the server gathered last, what the graph is asked to show, and whether the server is still there. The server tells the page when the project changed, and the page reads it again.

import { reactive } from "vue";
import type { RouteLocationNormalizedLoaded, Router } from "vue-router";
import type { Comparison } from "./graph-layer";
import type { StudioData } from "../../../types";

/** What another view asks the graph to show. The graph reads it, and keeps a comparison until the reader stops it. */
export type GraphFocus = {
    /** Another commit's graph against this one: its lines added, and those gone, drawn back. */
    comparison?: Comparison;
    /** Light the cables that carry this VLAN, by its ID, on the VLANs layer. */
    vlan?: number;
    /** Light these lines, by `GraphLayer.keyOf`. */
    path?: string[];
    /** Select this device. */
    device?: string;
};

export const store = reactive({
    data: undefined as StudioData | undefined,
    /** What stopped the server reading the project, shown over the page. */
    error: "",
    live: "connecting" as "connecting" | "live" | "offline",
    /** The project was read again just now. */
    beat: false,
    graphFocus: {} as GraphFocus,
});

/** Show something in the graph: set what it lights, then go to its layer. */
export function showInGraph(router: Router, layer: string, focus: GraphFocus): void {
    store.graphFocus = { ...(store.graphFocus.comparison ? { comparison: store.graphFocus.comparison } : {}), ...focus };
    void router.push({ name: "layer", params: { layer } });
}

/** One part of the path, such as the device in `/devices/edge-01`, as text: empty when the path leaves it out. */
export function paramOf(route: RouteLocationNormalizedLoaded, name: string): string {
    const value = route.params[name];
    return Array.isArray(value) ? value.join("/") : (value ?? "");
}

/** What the address asks after `?`, such as the packet of `/tools/firewall?device=edge-01&chain=input`, so a test can be bookmarked or sent. */
export function queryOf(route: RouteLocationNormalizedLoaded): URLSearchParams {
    const pairs = Object.entries(route.query).flatMap(([key, value]) =>
        [value].flat().flatMap((item) => (item === null ? [] : [[key, item]]))
    );
    return new URLSearchParams(pairs);
}

/** The reader's system asks for less motion: nothing moves for show, and changes happen at once. */
export const still = matchMedia("(prefers-reduced-motion: reduce)");

/** What the page keeps in the browser, such as where each device is on the graph. Storage can be missing or refuse, in a private window: the page works without it. */
export class Saved {
    static get<T>(key: string): T | undefined {
        try {
            const value = localStorage.getItem(`circuit-studio:${key}`);
            return value === null ? undefined : (JSON.parse(value) as T);
        } catch {
            return undefined;
        }
    }

    static set(key: string, value: unknown): void {
        try {
            localStorage.setItem(`circuit-studio:${key}`, JSON.stringify(value));
        } catch {
            // A browser that keeps nothing still works, until it reloads.
        }
    }
}

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
    events.addEventListener("open", () => (store.live = "live"));
    events.addEventListener("error", () => (store.live = "offline"));
    events.addEventListener("message", async () => {
        await load();
        store.beat = true;
        setTimeout(() => (store.beat = false), 1200);
    });
}
