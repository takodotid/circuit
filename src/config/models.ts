// The types read each platform's models from here, so a model or port that does not exist fails to compile.

import { models as fortios } from "../platforms/fortios/models";
import { models as junos } from "../platforms/junos/models";
import { models as raisecom } from "../platforms/raisecom-ros/models";
import { models as routeros } from "../platforms/routeros/models";
import { models as vrp } from "../platforms/vrp/models";

/** What a model's hardware holds, where a real device held less than its datasheet lists. `circuit validate` checks a config against it. */
export type ModelLimits = {
    /** The most member ports one LAG may have. More is an error. */
    readonly lag_members?: number;
    /** About how many switch rules the switch chip held. More is a warning: a rule the chip cannot hold is invalid, and so is every rule after it, without a log line. */
    readonly switch_rules?: number;
    /** How many distinct port ranges the switch rules held. More is a warning, for the same reason. */
    readonly switch_port_ranges?: number;
};

/** One model: its ports per class, how the platform spells a port, and what its hardware holds. */
export type ModelSpec = {
    /** How the platform spells a port of each class. `{n}` is the position within the class; `{n+4}` and `{n-1}` shift it, because some platforms number every port in one run or count from 0. */
    readonly spelling: Readonly<Record<string, string>>;
    /** What the hardware held, where a real device held less than its datasheet. */
    readonly limits?: ModelLimits;
    /** `false` when the model has no serial console, such as the RB5009: nothing is set for one, and `connection.console` is refused. A model has one when absent. */
    readonly serial_console?: false;
} & (
    | {
          /** How many ports of each speed class, such as `{ "10g": 48 }`. A port is `<class>-<position>`, such as `10g-4`. */
          readonly ports: Readonly<Record<string, number>>;
          readonly virtual?: never;
      }
    | {
          readonly ports?: never;
          /** A virtual machine, such as MikroTik's CHR. Its ports are the machine's network adapters, as many as it has, and it has no bootloader of its own, so nothing is set for one. */
          readonly virtual: true;
      }
);

/** Every model of every platform: each platform's own list, in its folder under `src/platforms/`. */
export const MODELS = { routeros, vrp, "raisecom-ros": raisecom, junos, fortios } as const satisfies Record<
    string,
    Record<string, ModelSpec>
>;

type Models = typeof MODELS;

/** The operating system of a device. It decides which adapter renders and applies the device. */
export type Platform = keyof Models;

/** A hardware model the platform runs on. It decides which port names exist. */
export type Model<P extends Platform> = P extends Platform ? keyof Models[P] & string : never;

type Upto<N extends number, A extends unknown[] = [], R = never> = A["length"] extends N
    ? R
    : Upto<N, [...A, 0], R | `${[...A, 0]["length"]}`>;
type SpecOf<P extends Platform, M extends string> = P extends Platform ? (M extends keyof Models[P] ? Models[P][M] : never) : never;
type PortsOf<P extends Platform, M extends string> = SpecOf<P, M> extends { ports: infer Ports } ? Ports : never;
type SpellingOf<P extends Platform, M extends string> = SpecOf<P, M> extends { spelling: infer Spelling } ? Spelling : never;

/** A port of the model, `<class>-<position>`: `10g-1` to `10g-48` on a model with 48 10G ports. On a virtual model, any position. */
export type PortName<P extends Platform, M extends string> =
    SpecOf<P, M> extends { virtual: true }
        ? `${keyof SpellingOf<P, M> & string}-${number}`
        : {
              [S in keyof PortsOf<P, M>]: `${S & string}-${Upto<PortsOf<P, M>[S] & number>}`;
          }[keyof PortsOf<P, M>];

const specOf = (platform: string, model: string): ModelSpec | undefined =>
    (MODELS as Record<string, Record<string, ModelSpec>>)[platform]?.[model];

/** Every port a model has, in order. None for a virtual model, whose ports are the machine's adapters. */
export function portsOf(platform: string, model: string): string[] {
    const ports = specOf(platform, model)?.ports ?? {};
    return Object.entries(ports).flatMap(([speed, count]) => Array.from({ length: count }, (_, i) => `${speed}-${i + 1}`));
}

/** Whether a name is a port of the model: one it has, or on a virtual model `<class>-<position>` of a class it spells. */
export function isPort(platform: string, model: string, port: string): boolean {
    const spec = specOf(platform, model);
    if (!spec?.virtual) return portsOf(platform, model).includes(port);

    const kind = /^(.+)-[1-9]\d*$/.exec(port)?.[1];
    return kind !== undefined && kind in spec.spelling;
}

/** A port as the platform prints it, from the model's `spelling`: `10g-2` on a FG-3700D is `port6`. The port as written when the model has no spelling for it. */
export function spell(platform: string, model: string, port: string): string {
    const [kind = "", n = ""] = port.split("-");
    const pattern = specOf(platform, model)?.spelling[kind];
    return pattern ? pattern.replace(/\{n([+-]\d+)?\}/g, (_, shift: string | undefined) => String(Number(n) + Number(shift ?? 0))) : port;
}

/** The platforms where a VLAN is only its number: no name, no description. A VLAN interface holds its own. Circuit drops a VLAN's `description` there, as their renderers do. */
export const NUMBERED_VLANS: readonly Platform[] = ["raisecom-ros", "fortios"];
