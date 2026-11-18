// Studio's page: one Vue app, which reads what the server gathered from the project.

import { createApp } from "vue";
import App from "./App.vue";
import { OldAddress } from "./lib/old-address";
import { connect } from "./lib/store";
import { studioRouter } from "./router";
import "./style.css";

// A bookmark from before Studio had paths, such as `/#devices/edge-01`, takes its page's path before the router reads the address.
const old = location.pathname === "/" ? OldAddress.path(location.hash) : undefined;
if (old) history.replaceState(history.state, "", old);

createApp(App).use(studioRouter()).mount("#app");
connect();
