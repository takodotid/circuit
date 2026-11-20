// The keys of the language, from the shapes in src/config/keys.ts, and the keys a value holds. Two tests walk them: every key is rendered or refused on each platform (test/platforms/every-key.test.ts), and written in some example (test/project/example-keys.test.ts).

import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { registry } from "../src/config/define";
import type { Registered } from "../src/config/define";
import type { Shape } from "../src/config/keys";
import type { Device } from "../src/model";
import { Project } from "../src/project";

/** A step into a value: a key, or an index in a list. */
export type Step = string | number;

/** A key a value holds: its path, such as `routing.static_routes[].prefix` with `*` for any name, and the steps to it. */
export type Held = { path: string; steps: Step[] };

type ShapeMap = Readonly<Record<string, Shape>>;

export class KeyPaths {
    /** The keys each test has not reached yet: a list that may only shrink. */
    private static readonly GAPS = join(import.meta.dir, "key-gaps.json");

    /** Every key path of `shape`, each before the keys inside it. */
    static all(shape: Shape, path = ""): string[] {
        if (shape === 0 || KeyPaths.secret(shape)) return [];
        if (Array.isArray(shape)) return KeyPaths.all((shape as readonly [Shape])[0], `${path}[]`);

        return Object.entries(shape as ShapeMap).flatMap(([key, inner]) => {
            const at = path ? `${path}.${key}` : key;
            return [at, ...KeyPaths.all(inner, at)];
        });
    }

    /** Each key `value` holds where `shape` takes it, read as `unknownKeys` reads it. A key whose value is `undefined` is not held. */
    static held(value: unknown, shape: Shape, path = "", steps: Step[] = []): Held[] {
        if (shape === 0 || KeyPaths.secret(shape) || !value || typeof value !== "object") return [];
        if (Array.isArray(value)) {
            // A list met where the shape is a map is a list of such maps, such as several port ranges.
            const item: Shape = Array.isArray(shape) ? (shape as readonly [Shape])[0] : shape;
            const at = Array.isArray(shape) ? `${path}[]` : path;
            return value.flatMap((v, i) => KeyPaths.held(v, item, at, [...steps, i]));
        }
        if (Array.isArray(shape)) return [];

        const map = shape as ShapeMap;
        return Object.entries(value).flatMap(([key, v]) => {
            const name = Object.hasOwn(map, "*") ? "*" : key;
            if (v === undefined || !Object.hasOwn(map, name)) return [];

            const at = path ? `${path}.${name}` : name;
            return [{ path: at, steps: [...steps, key] }, ...KeyPaths.held(v, map[name]!, at, [...steps, key])];
        });
    }

    /** The paths that are not inside another of them, in their order. */
    static topmost(paths: readonly string[]): string[] {
        return paths.filter((path) => !paths.some((outer) => KeyPaths.inside(path, outer)));
    }

    /**
     * What is wrong with `list` in `key-gaps.json` against the gaps `found` now: each new gap, with `fix`, and each listed gap closed since. Gaps found inside a closed one take its place.
     */
    static ratchet(found: readonly string[], list: string, fix: string): string[] {
        const listed = KeyPaths.listed(list);
        const closed = listed.filter((path) => !found.includes(path));
        const fresh = found.filter((path) => !listed.includes(path) && !closed.some((outer) => KeyPaths.inside(path, outer)));
        return [
            ...fresh.map((path) => `${path}: ${fix}`),
            ...(fresh.length ? ["Close each gap above. test/key-gaps.json only shrinks: never add to it."] : []),
            ...closed.map((path) => {
                const inside = found.filter((inner) => KeyPaths.inside(inner, path));
                return inside.length
                    ? `${path}: only the keys ${inside.join(", ")} inside it are still gaps. List them instead in ${list} in test/key-gaps.json.`
                    : `${path}: no longer a gap. Remove it from ${list} in test/key-gaps.json.`;
            }),
        ];
    }

    /** A list in `key-gaps.json` by its path, such as `platforms.routeros.silent`. */
    static listed(list: string): string[] {
        const gaps = JSON.parse(readFileSync(KeyPaths.GAPS, "utf8")) as unknown;
        return (list.split(".").reduce((value: any, key) => value?.[key], gaps) as string[] | undefined) ?? [];
    }

    /** Whether `path` is a key inside `outer`. */
    static inside(path: string, outer: string): boolean {
        return path.startsWith(`${outer}.`) || path.startsWith(`${outer}[]`);
    }

    /**
     * Each project in `examples/`, read by `Project.read` from a copy, as Bun imports a file once. `written` holds each device as its files write it: `Project.read` then writes out each communities rule in place, so a copy is taken as the device registers. With `filesFrom`, each device's certificate files are written from that folder, where a test reads files from.
     */
    static async examples(filesFrom?: string): Promise<{ settings: object[]; written: object[]; devices: Device[] }> {
        const examples = join(import.meta.dir, "..", "examples");
        const scratch = mkdtempSync(join(tmpdir(), "circuit-key-paths-"));
        const read = { settings: [] as object[], written: [] as object[], devices: [] as Device[] };
        const networks = registry.networks;
        networks.push = (...added: Registered[]) => {
            for (const network of added)
                network.devices.push = (...devices: Registered["devices"]) => {
                    read.written.push(...devices.map(({ device }) => structuredClone(device)));
                    return Array.prototype.push.apply(network.devices, devices);
                };
            return Array.prototype.push.apply(networks, added);
        };

        try {
            for (const name of readdirSync(examples).sort()) {
                cpSync(join(examples, name), join(scratch, name), { recursive: true });
                for (const network of (await Project.read(join(scratch, name))).networks) {
                    read.settings.push(network.settings);
                    read.devices.push(...Object.values(network.devices));
                    if (filesFrom) KeyPaths.rebase(Object.values(network.devices), join(examples, name), filesFrom);
                }
            }
        } finally {
            delete (networks as { push?: unknown }).push;
            rmSync(scratch, { recursive: true, force: true });
        }
        return read;
    }

    /** Each device's certificate files, written from the folder `to` instead of the project at `from`. */
    private static rebase(devices: readonly Device[], from: string, to: string): void {
        const certificates = devices.flatMap((device) => Object.values(device.system?.certificates ?? {}));
        for (const certificate of certificates)
            if (certificate) certificate.certificate_file = relative(to, join(from, certificate.certificate_file));
    }

    /** A secret is one key: `secret()` or `secretFile()` writes it whole. */
    private static secret(shape: Shape): boolean {
        return typeof shape === "object" && !Array.isArray(shape) && Object.keys(shape).sort().join() === "secret,secret_file";
    }
}
