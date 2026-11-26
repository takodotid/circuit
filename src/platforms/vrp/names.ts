import type { Device } from "../../model";

/** What the platform calls a loopback: `LoopBack0` and on, numbered in the order the config lists them. */
export class VrpNames {
    /** The loopback's name on the switch, or undefined when `name` is not a loopback. */
    static loopback(device: Device, name: string): string | undefined {
        const index = Object.keys(device.interfaces?.loopback ?? {}).indexOf(name);
        return index === -1 ? undefined : `LoopBack${index}`;
    }
}
