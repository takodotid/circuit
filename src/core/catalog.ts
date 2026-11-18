// The models' data is in `src/config/models.ts`, which a project's editor reads too. Here an unknown model or port is an error.

import { isPort, MODELS, portsOf, spell } from "../config/models";
import type { ModelLimits, ModelSpec } from "../config/models";
import type { Device } from "../model";
import { Derive } from "./derive";

export class Catalog {
    /** Every port a model has, in order. None for a virtual model, whose ports are the machine's adapters. */
    static ports(platform: string, model: string): string[] {
        if (!Catalog.spec(platform, model)) throw new Error(`${platform} has no model ${model}`);
        return portsOf(platform, model);
    }

    /** Every port of a device: its model's, or on a virtual model the ones its config names, as only a read finds the machine's adapters. */
    static devicePorts(device: Device): string[] {
        if (!Catalog.virtual(device.platform, device.model)) return Catalog.ports(device.platform, device.model);
        return Derive.ports(device).map(([name]) => name);
    }

    /** Whether a name is a port of the model. On a virtual model, any position of its class is. */
    static isPort(platform: string, model: string, port: string): boolean {
        return isPort(platform, model, port);
    }

    /** What the model's hardware holds. Empty for a model with no known limits, or a model the catalog doesn't have. */
    static limits(platform: string, model: string): ModelLimits {
        return Catalog.spec(platform, model)?.limits ?? {};
    }

    /** Whether the model has a serial console. True for a model the catalog doesn't have. */
    static serialConsole(platform: string, model: string): boolean {
        return Catalog.spec(platform, model)?.serial_console !== false;
    }

    /** Whether the model is a virtual machine. False for a model the catalog doesn't have. */
    static virtual(platform: string, model: string): boolean {
        return Catalog.spec(platform, model)?.virtual === true;
    }

    /** The platform's own name for a port, such as `port6` for `10g-2` on a FG-3700D. */
    static spell(platform: string, model: string, port: string): string {
        const kind = /^(.+)-\d+$/.exec(port)?.[1];
        if (!kind || !Catalog.spec(platform, model)?.spelling[kind]) throw new Error(`${model} has no port ${port}`);
        return spell(platform, model, port);
    }

    private static spec(platform: string, model: string): ModelSpec | undefined {
        return (MODELS as Record<string, Record<string, ModelSpec>>)[platform]?.[model];
    }
}
