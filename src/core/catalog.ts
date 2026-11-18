// Every hardware model Circuit knows, for Circuit's own code. The data and its types are in `src/config/models.ts`, which a project's editor reads too. Here an unknown model or port is an error.

import { MODELS, type ModelLimits, type ModelSpec, portsOf, spell } from "../config/models";

export class Catalog {
    /** Every port a model has, in order. */
    static ports(platform: string, model: string): string[] {
        if (!Catalog.spec(platform, model)) throw new Error(`${platform} has no model ${model}`);
        return portsOf(platform, model);
    }

    /** What the model's hardware holds. Empty for a model with no known limits, or a model the catalog doesn't have. */
    static limits(platform: string, model: string): ModelLimits {
        return Catalog.spec(platform, model)?.limits ?? {};
    }

    /** Whether the model has a serial console. True for a model the catalog doesn't have. */
    static serialConsole(platform: string, model: string): boolean {
        return Catalog.spec(platform, model)?.serial_console !== false;
    }

    /** The platform's own name for a port, such as `port6` for `10g-2` on a FG-3700D. */
    static spell(platform: string, model: string, port: string): string {
        const speed = /^(\d+(?:\.\d+)?[gm])-\d+$/.exec(port)?.[1];
        if (!speed || !Catalog.spec(platform, model)?.spelling[speed]) throw new Error(`${model} has no port ${port}`);
        return spell(platform, model, port);
    }

    private static spec(platform: string, model: string): ModelSpec | undefined {
        return (MODELS as Record<string, Record<string, ModelSpec>>)[platform]?.[model];
    }
}
