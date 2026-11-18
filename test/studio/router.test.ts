// Studio's pages by path: the BGP table is at /bgp, as the top bar names it. Its old path, /sessions, still opens it, and an old `#bgp` bookmark still opens the graph's BGP layer.

import { plugin } from "bun";
import { afterAll, expect, test } from "bun:test";
import { createMemoryHistory, type RouteLocationNormalizedLoaded, type Router, type RouterHistory } from "vue-router";
import { OldAddress } from "../../src/studio/app/src/lib/old-address";

// Only the paths are tested here, so each page's component loads as an empty one, and the page's store finds the one browser call it makes as it loads.
plugin({
    name: "Studio pages as empty components",
    setup(build) {
        build.onLoad({ filter: /\.vue$/ }, () => ({ contents: "export default {};", loader: "js" }));
    },
});
const page = globalThis as { matchMedia?: unknown };
const hadMatchMedia = "matchMedia" in page;
if (!hadMatchMedia) page.matchMedia = () => ({ matches: false });
afterAll(() => {
    if (!hadMatchMedia) delete page.matchMedia;
});

// Imported by a name TypeScript does not follow: the page's own files are checked with the page's types, in src/studio/app.
const routerFile = "../../src/studio/app/src/router";
const { studioRouter, viewOf } = (await import(routerFile)) as {
    studioRouter: (history: RouterHistory) => Router;
    viewOf: (route: RouteLocationNormalizedLoaded) => string;
};

test("the BGP table is at /bgp, and /sessions opens it too", async () => {
    const router = studioRouter(createMemoryHistory());

    await router.push("/bgp");
    expect(viewOf(router.currentRoute.value)).toBe("bgp");

    await router.push("/sessions");
    expect(router.currentRoute.value.path).toBe("/bgp");
});

test("an old #bgp bookmark opens the graph's BGP layer, and #sessions the table", async () => {
    const router = studioRouter(createMemoryHistory());

    await router.push(OldAddress.path("#bgp")!);
    expect(router.currentRoute.value.path).toBe("/graph/bgp");
    expect(viewOf(router.currentRoute.value)).toBe("graph");

    await router.push(OldAddress.path("#sessions")!);
    expect(router.currentRoute.value.path).toBe("/bgp");
});
