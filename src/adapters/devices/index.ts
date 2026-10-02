import { raisecom } from "./raisecom-ros";
import { routeros } from "./routeros";
import type { DeviceAdapter } from "./types";
import { vrp } from "./vrp";

/** Every platform the framework can render and apply, by name. */
export const adapters: Record<string, DeviceAdapter> = { routeros, vrp, "raisecom-ros": raisecom };
