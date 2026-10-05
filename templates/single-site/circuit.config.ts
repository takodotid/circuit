// The network: every device Circuit manages, and your own checks.

import { defineNetwork } from "@takodotid/circuit";
import checks from "./checks";
import router from "./router";
import sw from "./switch";

export default defineNetwork({ devices: [router, sw], checks });
