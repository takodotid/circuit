// The platform examples as one network, so `scripts/golden.ts` and the CLI can run on them together.

import { defineNetwork } from "@takodotid/circuit";
import fortios from "./fortios";
import fortiosTransparent from "./fortios-transparent";
import junos from "./junos";
import raisecomRos from "./raisecom-ros";
import routeros from "./routeros";
import vrp from "./vrp";

export default defineNetwork({
    devices: [routeros, vrp, raisecomRos, junos, fortios, fortiosTransparent],
});
