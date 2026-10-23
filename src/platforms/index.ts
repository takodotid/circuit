import { FortiOs } from "./fortios";
import { Junos } from "./junos";
import type { Platform } from "./platform";
import { RaisecomRos } from "./raisecom-ros";
import { RouterOs } from "./routeros";
import { Vrp } from "./vrp";

/** Every platform the framework can render and apply, by name. */
export class Platforms {
    private static readonly BY_NAME: ReadonlyMap<string, Platform> = new Map(
        [new RouterOs(), new Vrp(), new RaisecomRos(), new Junos(), new FortiOs()].map((platform) => [platform.name, platform])
    );

    /** The platform of that name, or undefined when there is none. */
    static find(name: string): Platform | undefined {
        return Platforms.BY_NAME.get(name);
    }

    /** The platform of that name. Throws when there is none. */
    static get(name: string): Platform {
        const platform = Platforms.find(name);
        if (!platform) throw new Error(`no adapter for platform ${name}`);

        return platform;
    }

    /** Every platform, in the order the framework lists them. */
    static all(): Platform[] {
        return [...Platforms.BY_NAME.values()];
    }

    /** Every platform's name. */
    static names(): string[] {
        return [...Platforms.BY_NAME.keys()];
    }
}
