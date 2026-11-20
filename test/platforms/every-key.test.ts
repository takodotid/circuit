// Every key of a device is, on each platform, rendered or refused by its unsupported(): none is skipped without a word. Each key is tried on the devices of the examples and of Circuit 0.x (test/fixtures.ts): removed, or given another value written for it. The render or the refusals must change. The keys not reached yet are in test/key-gaps.json, a list that may only shrink.

import { expect, test } from "bun:test";
import { Checks } from "../../src/checks";
import { DEVICE } from "../../src/config/keys";
import type { Shape } from "../../src/config/keys";
import { MODELS, NUMBERED_VLANS, portsOf } from "../../src/config/models";
import type { Platform as PlatformName } from "../../src/config/models";
import { Utils } from "../../src/core/utils";
import type { Device } from "../../src/model";
import { Platforms } from "../../src/platforms";
import type { Platform } from "../../src/platforms/platform";
import { Fixtures } from "../fixtures";
import { KeyPaths } from "../key-paths";
import type { Held, Step } from "../key-paths";

type ShapeMap = Readonly<Record<string, Shape>>;

/** A platform's gaps: the keys it neither renders nor refuses, and those no device that validates could try yet. `sent` holds its documentation-only keys it renders or refuses after all. */
type PlatformGaps = { silent: string[]; untried: string[]; sent: string[] };

/** Keys Circuit reads itself, which no platform renders, each with what reads it. In a pattern, `*` stands for one key and `**` for any keys. */
const READ_BY_CIRCUIT: Record<string, string> = {
    site: "the communities and the integrations",
    role: "the NetBox integration",
    connection: "the SSH and console logins",
    "interfaces.*.*.link": "the cabling checks and LLDP",
    "interfaces.*.*.exchange": "the PeeringDB integration",
    "switching.vlans.*.untrusted": "the untrusted_vlans check",
    "routing.prefix_sets.*.source": "circuit diff, which fetches the prefixes",
};

/** Keys `Project.read` writes out before a platform reads the device, each with what it writes. */
const WRITTEN_OUT: Record<string, string> = {
    "routing.bgp.*.*.communities": "route policy rules",
    "routing.policies.*[].communities": "route policy rules",
    "routing.policies.*[].accept_requests": "route policy rules",
    "routing.policies.*[].add_tags": "route policy rules",
    "routing.policies.*[].keep_ours": "route policy rules",
    "routing.policies.*[].send_tags": "route policy rules",
    "routing.prefix_sets.*.prefixes.*": "a list of prefixes",
    "firewall.interface_sets": "each set's interfaces",
    "firewall.**.in_interface_set": "each set's interfaces",
    "firewall.**.out_interface_set": "each set's interfaces",
};

/** Keys `Project.read` takes out on some platforms. */
const TAKEN_OUT: Record<string, readonly string[]> = Object.fromEntries(
    NUMBERED_VLANS.map((platform) => [platform, ["switching.vlans.*.description"]])
);

/** Keys a platform has no place for, each with why. There they are documentation only, as their doc comments say: Studio and the NetBox integration show them, and the platform neither renders nor refuses them. */
const DOCUMENTATION_ONLY: Partial<Record<PlatformName, Record<string, string>>> = {
    junos: { "services.dhcp_server.*.reservations[].description": "a static binding, `host` in an address pool, has no description" },
    fortios: { "interfaces.bridge.*.description": "a bridge is a forward domain, a number set on each member" },
};

/** A key from another platform's device goes into at most this many of the platform's own devices. That is enough to land where it means something. */
const BASES = 4;
/** At most this many entries of a list, or of a map with any names, are tried. */
const ENTRIES = 3;
/** At most this many other values each key is given. */
const OTHER_VALUES = 3;
/** At most this many devices try each key, so a key that many devices hold stays quick. */
const TRIES = 40;

const THROWS = "throws: ";

/** Whether `path` is `pattern` or inside it. */
function matches(path: string, pattern: string): boolean {
    const regex = pattern
        .replace(/[.[\]]/g, "\\$&")
        .replace(/\*\*/g, ".+")
        .replace(/\*/g, "[^.]+");
    return new RegExp(`^${regex}(?=$|\\.|\\[)`).test(path);
}

const skipped = (path: string, platform?: string): boolean =>
    [...Object.keys(READ_BY_CIRCUIT), ...Object.keys(WRITTEN_OUT), ...(TAKEN_OUT[platform ?? ""] ?? [])].some((pattern) =>
        matches(path, pattern)
    );

const at = (value: unknown, steps: readonly Step[]): any => steps.reduce((v: any, step) => v?.[step], value);

/** The steps as a platform writes them in a refusal: `firewall.nat.source[0].to_port`. */
const named = (steps: readonly Step[]): string =>
    steps.map((step, i) => (typeof step === "number" ? `[${step}]` : i ? `.${step}` : step)).join("");

/** A copy of `device` with `value` at `steps`, or with nothing there when `value` is undefined. */
function written(device: Device, steps: readonly Step[], value: unknown): Device {
    const copy = structuredClone(device);
    const holder = at(copy, steps.slice(0, -1));
    if (value === undefined) delete holder[steps.at(-1)!];
    else holder[steps.at(-1)!] = structuredClone(value);
    return copy;
}

/**
 * `device` as if it ran `platform`, so a key is tried with all it stands beside. It runs on a model with every port it uses. Else it runs on the model with the most ports, each missing port renamed to a free one.
 */
function moved(device: Device, platform: string): Device {
    const ports = Object.keys(device.interfaces?.ethernet ?? {});
    const models = Object.keys(MODELS[platform as keyof typeof MODELS]);
    const fits = models.find((model) => ports.every((port) => portsOf(platform, model).includes(port)));
    if (fits) return { ...device, platform, model: fits } as Device;

    const model = models.reduce((most, next) => (portsOf(platform, next).length > portsOf(platform, most).length ? next : most));
    const has = portsOf(platform, model);
    const free = has.filter((port) => !ports.includes(port));
    const renamed = new Map(ports.filter((port) => !has.includes(port)).map((port, i) => [port, free[i] ?? port]));
    const json = JSON.stringify(device).replace(/"([^"]*)"/g, (whole, text: string) =>
        renamed.has(text) ? `"${renamed.get(text)}"` : whole
    );
    return { ...(JSON.parse(json) as Device), platform, model } as Device;
}

/**
 * `base` with the key `held` points to in `source` written in, each way it fits, and the steps to the key. A step goes into what `base` has: the same key, or the first few entries of a list or of a map with any names. At each step, `source`'s whole map or list item there is tried too. So the key comes with what gives it meaning, such as the BGP neighbors that use a group.
 */
function* grafts(base: Device, source: Device, held: Held): Generator<[Device, Step[]]> {
    /** Each place in `base` to write what `source` holds after its first `from` steps, deepest first. */
    function* places(into: any, shape: Shape, i: number, steps: Step[]): Generator<[Step[], number]> {
        const step = held.steps[i]!;
        const last = i === held.steps.length - 1;
        if (typeof step === "number") {
            if (!Array.isArray(into) || last) return;
            for (const [index, item] of into.slice(0, ENTRIES).entries())
                if (item && typeof item === "object") yield* places(item, shape, i + 1, [...steps, index]);
            yield [[...steps, into.length], i + 1];
            return;
        }
        if (!into || typeof into !== "object" || Array.isArray(into)) return;

        const map = shape as ShapeMap;
        const anyName = Object.hasOwn(map, "*");
        const names = anyName && !Object.hasOwn(into, step) ? [...Object.keys(into).slice(0, ENTRIES), step] : [step];
        const inner: Shape = map[anyName ? "*" : step]!;
        const next = at(source, held.steps.slice(0, i + 1));
        for (const name of names) {
            const there = into[name];
            if (!last && there && typeof there === "object" && Array.isArray(there) === Array.isArray(next))
                yield* places(there, Array.isArray(inner) ? (inner as readonly [Shape])[0] : inner, i + 1, [...steps, name]);
            if (name === step) yield [[...steps, name], i + 1];
        }
    }

    for (const [target, from] of places(base, DEVICE, 0, [])) {
        const device = written(base, target, at(source, held.steps.slice(0, from)));
        yield [device, [...target, ...held.steps.slice(from)]];
    }
}

/** What the platform makes of a device: its render and its refusals, or the error each throws. */
function observe(platform: Platform, device: Device): { render: string; refused: string[] } {
    const attempt = <T>(run: () => T, failed: (message: string) => T): T => {
        try {
            return run();
        } catch (error) {
            return failed(`${THROWS}${error instanceof Error ? error.message : String(error)}`);
        }
    };
    return {
        render: attempt(
            () => platform.render(device),
            (message) => message
        ),
        refused: attempt(
            () => platform.unsupported(device),
            (message) => [message]
        ),
    };
}

/** Whether a refusal gives the key at `steps`, or gives alone a map or list the key is in: `system.alarms.link-down, ...`. */
function refused(messages: readonly string[], steps: readonly Step[]): boolean {
    const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const key = new RegExp(`(^|[ ,])${escape(named(steps))}($|[ ,])`);
    const holders = steps.map((_, i) => new RegExp(`(^|[ ,])${escape(named(steps.slice(0, i + 1)))}($|,)`));
    return messages.some((message) => key.test(message) || holders.some((holder) => holder.test(message)));
}

/** Whether a device validates: Circuit renders no other. */
function valid(device: Device): boolean {
    try {
        return Checks.run([device], undefined).every((finding) => finding.level !== "error");
    } catch {
        return false;
    }
}

/** Each key the devices hold, by its path. */
function byPath(devices: readonly Device[]): Map<string, { device: Device; held: Held }[]> {
    const found = new Map<string, { device: Device; held: Held }[]>();
    for (const device of devices)
        for (const one of KeyPaths.held(device, DEVICE)) found.set(one.path, [...(found.get(one.path) ?? []), { device, held: one }]);
    return found;
}

/** The first few places in each device, such as the first few ports with a description. */
const few = <T extends { device: Device }>(found: readonly T[]): T[] =>
    found.filter((one, i) => found.slice(0, i).filter(({ device }) => device === one.device).length < ENTRIES);

/** The shape that holds the key at `path`, and the key's name: `NAT_RULE` and `then` for `firewall.nat.source[].then`. */
function kindOf(path: string): [Shape, string] {
    const keys = path.split(".");
    let shape: Shape = DEVICE;
    for (const key of keys.slice(0, -1)) {
        shape = (shape as ShapeMap)[key.replace(/\[\]$/, "")]!;
        if (key.endsWith("[]")) shape = (shape as readonly [Shape])[0];
    }
    return [shape, keys.at(-1)!];
}

Utils.root = Fixtures.FOLDER;
const devices: Device[] = [...(await KeyPaths.examples(Fixtures.FOLDER)).devices, ...Fixtures.names().map((name) => Fixtures.device(name))];
const paths = KeyPaths.all(DEVICE);
const held = byPath(devices);

/** Every value written for each key, once each: at its path first, then at each path of the same kind, such as `then` in the other NAT chain. */
const values = new Map<string, unknown[]>();
const kinds = new Map([...held.keys()].map((path) => [path, kindOf(path)]));
for (const [path, [shape, name]] of kinds) {
    const alike = [...kinds].filter(([other, kind]) => other !== path && kind[0] === shape && kind[1] === name).map(([other]) => other);
    const all = [path, ...alike].flatMap((one) => held.get(one)!.map(({ device, held: place }) => at(device, place.steps)));
    values.set(path, [...new Map(all.map((value) => [JSON.stringify(value), value])).values()]);
}

/** What each platform made of each device as written, before a key changed. */
const seen = new Map<string, WeakMap<Device, ReturnType<typeof observe>>>();

/** Whether changing the key at `steps` changes what the platform makes of `device`. Undefined when the device can't show it: it doesn't validate. */
function reacts(platform: Platform, device: Device, steps: Step[], path: string): boolean | undefined {
    if (!seen.has(platform.name)) seen.set(platform.name, new WeakMap());
    const cache = seen.get(platform.name)!;
    if (!cache.has(device)) cache.set(device, observe(platform, device));
    const before = cache.get(device)!;
    if (refused(before.refused, steps)) return true;

    const value = at(device, steps);
    const others = values
        .get(path)!
        .filter((other) => JSON.stringify(other) !== JSON.stringify(value))
        .slice(0, OTHER_VALUES);
    if (typeof value === "boolean" && !others.includes(!value)) others.push(!value);
    if (typeof value === "number" && !others.length) others.push(value + 1);

    for (const other of [undefined, ...others]) {
        const after = observe(platform, written(device, steps, other));
        if (after.render !== before.render || JSON.stringify(after.refused) !== JSON.stringify(before.refused)) return true;
    }
    return !before.render.startsWith(THROWS) && valid(device) ? false : undefined;
}

/** The keys this platform neither renders nor refuses, and those no device that validates could try. */
function gapsOf(platform: Platform): PlatformGaps {
    const own = devices.filter((device) => device.platform === platform.name);
    // The platform's own devices, then each other device moved to it, then each key written into the platform's own.
    const here = byPath([...own, ...devices.filter((device) => !own.includes(device)).map((device) => moved(device, platform.name))]);
    function* tries(path: string): Generator<[Device, Step[]]> {
        for (const { device, held: one } of few(here.get(path) ?? [])) yield [device, one.steps];
        for (const { device, held: one } of few(held.get(path)!))
            for (const base of own.slice(0, BASES)) if (device.platform !== platform.name) yield* grafts(base, device, one);
    }

    const handled = new Set<string>();
    const silent: string[] = [];
    const untried: string[] = [];
    // The keys inside a map first: a map is handled when any key in it is.
    for (const path of [...paths].reverse()) {
        if (skipped(path, platform.name) || !held.has(path)) continue;
        if (paths.some((inner) => KeyPaths.inside(inner, path) && handled.has(inner))) {
            handled.add(path);
            continue;
        }

        let result: boolean | undefined;
        for (const [device, steps] of tries(path).take(TRIES)) {
            result = reacts(platform, device, steps, path) ?? result;
            if (result) break;
        }
        if (result) handled.add(path);
        else (result === false ? silent : untried).push(path);
    }

    const documented = (path: string) => Object.keys(DOCUMENTATION_ONLY[platform.name] ?? {}).some((pattern) => matches(path, pattern));
    const silentAtTop = KeyPaths.topmost(silent.reverse());
    return {
        silent: silentAtTop.filter((path) => !documented(path)),
        untried: KeyPaths.topmost(untried.reverse()).filter((path) => !silentAtTop.some((outer) => KeyPaths.inside(path, outer))),
        sent: [...handled].filter(documented),
    };
}

for (const platform of Platforms.all()) {
    test(`${platform.name} renders or refuses every key`, () => {
        const found = gapsOf(platform);
        const list = `platforms.${platform.name}`;

        expect([
            ...KeyPaths.ratchet(
                found.silent,
                `${list}.silent`,
                `${platform.name} neither renders nor refuses it. Render it, or name it in unsupported() in src/platforms/${platform.name}/.`
            ),
            ...KeyPaths.ratchet(
                found.untried,
                `${list}.untried`,
                `no device that validates on ${platform.name} holds it. Write it in an example on ${platform.name}.`
            ),
            ...found.sent.map(
                (path) =>
                    `${path}: ${platform.name} renders or refuses it. Take it out of DOCUMENTATION_ONLY, and its platform out of its doc comment in src/config/.`
            ),
        ]).toEqual([]);
    });
}

test("each key a platform reads is written in some device, so it can be tried", () => {
    const noExample = KeyPaths.listed("examples");
    const unwritten = paths.filter(
        (path) => !held.has(path) && !skipped(path) && !noExample.some((gap) => gap === path || KeyPaths.inside(path, gap))
    );

    expect(unwritten.map((path) => `${path}: no device holds it. Write it in an example project in examples/.`)).toEqual([]);
});

test("each key Circuit reads itself, writes out, or leaves as documentation is a key", () => {
    const patterns = [
        ...Object.keys(READ_BY_CIRCUIT),
        ...Object.keys(WRITTEN_OUT),
        ...Object.values(DOCUMENTATION_ONLY).flatMap((keys) => Object.keys(keys)),
    ];

    expect(patterns.filter((pattern) => !paths.some((path) => matches(path, pattern)))).toEqual([]);
});
