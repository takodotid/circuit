import { defineNetwork } from "@takodotid/circuit";
import { exchange } from "./exchange";
import sw1 from "./ix-sw-01";
import sw2 from "./ix-sw-02";

export default defineNetwork({ devices: [sw1, sw2], checks: [exchange.check] });
