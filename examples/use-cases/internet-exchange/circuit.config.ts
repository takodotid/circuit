import { defineNetwork } from "@takodotid/circuit";
import { exchange } from "./exchange";
import fabric from "./ix-sw-01";

export default defineNetwork({ devices: [fabric], checks: [exchange.check] });
