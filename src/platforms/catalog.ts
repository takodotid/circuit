// Every model each platform supports. Types read from here, so a model or port name that does not exist fails to compile.

import { models as fortios } from "./fortios/models";
import { models as junos } from "./junos/models";
import { models as raisecom } from "./raisecom-ros/models";
import { models as routeros } from "./routeros/models";
import { models as vrp } from "./vrp/models";

export class Catalog {
    static readonly MODELS = { routeros, vrp, "raisecom-ros": raisecom, junos, fortios } as const;

    /** Every port a model has, in order. */
    static ports(platform: string, model: string): string[] {
        const spec = (Catalog.MODELS as Record<string, Record<string, { ports: Record<string, number> }>>)[platform]?.[model];
        if (!spec) throw new Error(`${platform} has no model ${model}`);
        return Object.entries(spec.ports).flatMap(([speed, count]) => Array.from({ length: count }, (_, i) => `${speed}-${i + 1}`));
    }

    /** The platform's own name for a port. */
    static spell(platform: string, model: string, port: string): string {
        const spec = (Catalog.MODELS as Record<string, Record<string, { spelling: Record<string, string> }>>)[platform]?.[model];
        const parts = /^(\d+[gm])-(\d+)$/.exec(port);
        const template = parts && spec?.spelling[parts[1]!];
        if (!template) throw new Error(`${model} has no port ${port}`);

        // A platform that counts from 0, or numbers one class after another, shifts the position: `{n-1}`, `{n+47}`.
        return template.replace(/\{n([+-]\d+)?\}/, (_, shift?: string) => String(Number(parts[2]) + Number(shift ?? 0)));
    }
}

export type Models = typeof Catalog.MODELS;
export type PlatformName = keyof Models;
export type ModelName<Pl extends PlatformName> = keyof Models[Pl] & string;

type Upto<N extends number, A extends unknown[] = [], R = never> = A["length"] extends N
    ? R
    : Upto<N, [...A, 0], R | `${[...A, 0]["length"]}`>;
type PortsOf<Pl extends PlatformName, M extends ModelName<Pl>> = Models[Pl][M] extends { ports: infer P } ? P : never;

/** `10g-1` to `10g-48` on a model with 48 10G ports. */
export type PortName<Pl extends PlatformName, M extends ModelName<Pl>> = {
    [S in keyof PortsOf<Pl, M>]: `${S & string}-${Upto<PortsOf<Pl, M>[S] & number>}`;
}[keyof PortsOf<Pl, M>];
