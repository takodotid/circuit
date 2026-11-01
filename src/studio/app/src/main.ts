// Studio's page: one Vue app, which reads what the server gathered from the project.

import { createApp } from "vue";
import App from "./App.vue";
import { connect } from "./lib/store";
import "./style.css";

createApp(App).mount("#app");
connect();
