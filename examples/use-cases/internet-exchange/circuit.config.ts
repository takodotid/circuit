import { defineNetwork } from "@takodotid/circuit";
import checks from "./checks";
import fabric from "./ix-sw-01";

export default defineNetwork({ devices: [fabric], checks });
