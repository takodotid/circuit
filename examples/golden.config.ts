// The standalone examples as one network, so `scripts/golden.ts` and the CLI can run on them together.

import { defineNetwork } from "@takodotid/circuit";
import aggregationSwitch from "./aggregation-switch";
import coreSwitch from "./core-switch";
import firewall from "./firewall";
import router from "./router";
import switchDevice from "./switch";
import transparentFirewall from "./transparent-firewall";

export default defineNetwork({
    devices: [router, switchDevice, coreSwitch, aggregationSwitch, firewall, transparentFirewall],
});
