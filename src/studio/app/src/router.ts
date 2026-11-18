// Studio's pages, each at its own path, such as `/devices/edge-01` or `/tools/firewall?device=edge-01&chain=input`. The server answers every path with the page, so a reload, a bookmark, or a link sent to someone opens the same place.

import { h } from "vue";
import { createRouter, createWebHistory, type RouteLocationNormalizedLoaded, type RouteRecordRaw, type Router } from "vue-router";
import { store } from "./lib/store";
import AddressesView from "./components/AddressesView.vue";
import CablesView from "./components/CablesView.vue";
import CompareView from "./components/CompareView.vue";
import DeviceView from "./components/DeviceView.vue";
import DevicesView from "./components/DevicesView.vue";
import GraphView from "./components/GraphView.vue";
import ProblemsView from "./components/ProblemsView.vue";
import SearchView from "./components/SearchView.vue";
import SecretsView from "./components/SecretsView.vue";
import SessionsView from "./components/SessionsView.vue";
import ToolsView from "./components/ToolsView.vue";
import VlansView from "./components/VlansView.vue";

declare module "vue-router" {
    interface RouteMeta {
        /** The view in the top bar the page belongs to, when it is not the page's own name. */
        view?: string;
        /** The page fills the window itself, as the graph does, instead of being a page of tables. */
        whole?: boolean;
    }
}

/** What the server gathered: every view shows it. */
const data = () => ({ data: store.data });

const tool = (name: string, path: string): RouteRecordRaw => ({ path, name, component: ToolsView, props: data, meta: { view: "tools" } });

const routes: RouteRecordRaw[] = [
    // The graph shows the layer shown last, or the one its path names.
    { path: "/", name: "graph", component: GraphView, props: data, meta: { whole: true } },
    { path: "/graph/:layer", name: "layer", component: GraphView, props: data, meta: { view: "graph", whole: true } },
    { path: "/devices", name: "devices", component: DevicesView, props: data },
    {
        path: "/devices/:name/:section?",
        name: "device",
        component: DeviceView,
        props: (route) => ({ data: store.data, name: route.params.name, section: route.params.section || "overview" }),
        meta: { view: "devices", whole: true },
    },
    { path: "/vlans", name: "vlans", component: VlansView, props: data },
    { path: "/addresses", name: "addresses", component: AddressesView, props: data },
    { path: "/sessions", name: "sessions", component: SessionsView, props: data },
    { path: "/cables", name: "cables", component: CablesView, props: data },
    { path: "/tools", redirect: { name: "trace" } },
    tool("trace", "/tools/trace/:address?"),
    tool("vlan", "/tools/vlan"),
    tool("firewall", "/tools/firewall"),
    tool("policy", "/tools/policy"),
    { path: "/compare/:ref?", name: "compare", component: CompareView, props: data },
    { path: "/secrets", name: "secrets", component: SecretsView },
    { path: "/problems", name: "problems", component: ProblemsView, props: data },
    {
        path: "/search",
        name: "search",
        component: SearchView,
        props: (route) => ({ data: store.data, query: String(route.query.q ?? "") }),
    },
    { path: "/:missing(.*)*", name: "missing", component: { render: () => h("p", { class: "muted" }, "Nothing here.") } },
];

/** The router, which reads the address as it is made. */
export function studioRouter(): Router {
    return createRouter({ history: createWebHistory(), routes });
}

/** The view in the top bar a page belongs to, such as `devices` for a device's page. */
export function viewOf(route: RouteLocationNormalizedLoaded): string {
    return route.meta.view ?? String(route.name ?? "");
}

/** Each page by what it shows: a new one fades in, and the same one changed in place, such as another tab of a device, does not. */
export function placeOf(route: RouteLocationNormalizedLoaded): string {
    if (viewOf(route) === "graph") return "graph";
    if (route.name === "device") return `device ${String(route.params.name)}`;
    if (route.name === "compare") return `compare ${String(route.params.ref)}`;
    return String(route.name ?? "");
}
